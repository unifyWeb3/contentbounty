import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAccount, createClient } from 'genlayer-js'
import { selectGenLayerNetwork } from '../../scripts/genlayer-network.mjs'
import {
  classifyOnChainAdversarialCommitment,
  loadCommittedLiveAdversarialFixture,
} from '../../scripts/live-adversarial-fixture.mjs'
import { waitForLiveLifecycle } from '../../scripts/live-lifecycle.mjs'
import { selectLiveProofMode } from '../../scripts/live-proof-mode.mjs'
import {
  checkpointProof,
  createProofArtifact,
  proofJson,
  recordProofFailure,
  updateProofCompletion,
} from '../../scripts/live-proof-store.mjs'

const requiredNames = [
  'LIVE_GENLAYER_NETWORK',
  'LIVE_PROOF_MODE',
  'LIVE_DEPLOYER_PRIVATE_KEY',
  'LIVE_CREATOR_PRIVATE_KEY',
  'LIVE_APPROVE_EVIDENCE_URI',
  'LIVE_REJECT_EVIDENCE_URI',
  'LIVE_MUTABLE_EVIDENCE_URI',
  'LIVE_MUTATION_WEBHOOK_URL',
]

function requiredEnvironment() {
  const missing = requiredNames.filter((name) => !process.env[name]?.trim())
  if (missing.length) {
    throw new Error(`Live consensus test requires: ${missing.join(', ')}`)
  }
  for (const name of ['LIVE_DEPLOYER_PRIVATE_KEY', 'LIVE_CREATOR_PRIVATE_KEY']) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[name])) {
      throw new Error(`${name} must be a 0x-prefixed 32-byte key`)
    }
  }
  for (const name of requiredNames.filter((item) => item.endsWith('_URI') || item.endsWith('_URL'))) {
    if (!process.env[name].startsWith('https://')) throw new Error(`${name} must use HTTPS`)
  }
}

function explorerBase(chain) {
  return chain.blockExplorers.default.url.replace(/\/$/, '')
}

async function waitLifecycle(client, hash, label, chain, proof, checkpoint) {
  const transactionProof = {
    label,
    hash,
    explorer: `${explorerBase(chain)}/tx/${hash}`,
    observations: [],
    acceptedPhaseObserved: false,
    successfulFinalizationObserved: false,
    separateAcceptedAndFinalizedObservations: false,
  }
  proof.transactions.push(transactionProof)
  checkpoint()
  const lifecycle = await waitForLiveLifecycle({
    client,
    hash,
    acceptedOptions: { retries: 180, interval: 3000 },
    finalizedOptions: { retries: 360, interval: 5000 },
    onObservation: (observation) => {
      transactionProof.observations.push(observation)
      checkpoint()
    },
  })
  transactionProof.acceptedPhaseObserved = lifecycle.acceptedPhaseObserved
  transactionProof.successfulFinalizationObserved = lifecycle.successfulFinalizationObserved
  transactionProof.separateAcceptedAndFinalizedObservations = lifecycle.separateAcceptedAndFinalizedObservations
  transactionProof.accepted = lifecycle.observations.find((item) => item.phase === 'ACCEPTED') ?? null
  transactionProof.finalized = lifecycle.observations.find((item) => item.phase === 'FINALIZED') ?? null
  checkpoint()
  return lifecycle.finalizedReceipt
}

async function readAll(client, address, functionName, leadingArgs = []) {
  const result = []
  for (let offset = 0; ; offset += 50) {
    const page = await client.readContract({
      address,
      functionName,
      args: [...leadingArgs, offset, 50],
    })
    result.push(...page)
    if (page.length < 50) return result
  }
}

async function writeAndFinalize(client, account, chain, proof, checkpoint, request, label) {
  const hash = await client.writeContract({ account, ...request })
  await waitLifecycle(client, hash, label, chain, proof, checkpoint)
  return hash
}

export async function main() {
  requiredEnvironment()
  const configuredNetwork = process.env.LIVE_GENLAYER_NETWORK.trim()
  const { name: network, chain } = selectGenLayerNetwork(configuredNetwork)
  const proofMode = selectLiveProofMode(network, process.env.LIVE_PROOF_MODE)
  const deployer = createAccount(process.env.LIVE_DEPLOYER_PRIVATE_KEY)
  const creator = createAccount(process.env.LIVE_CREATOR_PRIVATE_KEY)
  if (deployer.address.toLowerCase() === creator.address.toLowerCase()) {
    throw new Error('Live deployer and creator accounts must be distinct for balance-delta proof')
  }
  const deployerClient = createClient({ chain, account: deployer })
  const creatorClient = createClient({ chain, account: creator })
  const sourcePath = fileURLToPath(new URL('../../contracts/content_bounty.py', import.meta.url))
  const code = readFileSync(sourcePath, 'utf8')
  const adversarialFixture = loadCommittedLiveAdversarialFixture()
  const reward = BigInt(process.env.LIVE_REWARD_WEI || '1000000000000000')
  const output = process.env.LIVE_PROOF_OUTPUT || '/tmp/contentbounty-live-consensus-proof.json'
  const proof = createProofArtifact(output, {
    generatedAt: new Date().toISOString(),
    network,
    proofMode: proofMode.mode,
    persistent: proofMode.persistent,
    balancesSimulated: proofMode.balancesSimulated,
    persistentPayoutProofEligible: proofMode.persistentPayoutProofEligible,
    persistentPayoutProofValid: false,
    valueSemantics: proofMode.balancesSimulated
      ? 'SIMULATED_STUDIONET_VALUES_NOT_VALID_FOR_PERSISTENT_PAYOUT_PROOF'
      : 'PERSISTENT_PUBLIC_TESTNET_VALUES',
    chainId: chain.id,
    rpc: chain.rpcUrls.default.http[0],
    consensusContract: chain.consensusMainContract.address,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceSha256: createHash('sha256').update(code).digest('hex'),
    deployer: deployer.address,
    creator: creator.address,
    contractAddress: '',
    adversarialRejectionFixture: {
      fixtureVersion: adversarialFixture.fixtureVersion,
      fixtureName: adversarialFixture.fixtureName,
      expectedNormalizedSha256: adversarialFixture.expectedNormalizedSha256,
      observedOnChainSha256: '',
      characterCount: adversarialFixture.characterCount,
      description: adversarialFixture.description,
      adversarialCases: adversarialFixture.adversarialCases,
      verified: false,
    },
    transactions: [],
    scenarios: {},
    unsupported: {
      fabricatedLeaderDisagreement: 'The public SDK/testnets expose no leader-result fabrication hook; use an authorized validator harness when GenLayer provides one.',
    },
  })
  const checkpoint = () => checkpointProof(output, proof)

  try {
    const deploymentHash = await deployerClient.deployContract({ account: deployer, code, args: [] })
    const deploymentReceipt = await waitLifecycle(
      deployerClient,
      deploymentHash,
      'deploy v2.1.1',
      chain,
      proof,
      checkpoint,
    )
    const address = deploymentReceipt?.data?.contract_address
      ?? deploymentReceipt?.contractAddress
      ?? deploymentReceipt?.result?.contract_address
    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error('Finalized deployment receipt did not contain a contract address')
    }
    proof.contractAddress = address
    proof.contractExplorer = `${explorerBase(chain)}/address/${address}`
    proof.scenarios.deployment = {
      hash: deploymentHash,
      explorer: `${explorerBase(chain)}/tx/${deploymentHash}`,
      address,
      finalized: true,
    }
    proof.completionChecks.deploymentFinalized = true
    updateProofCompletion(proof)
    checkpoint()

    const rubric = JSON.stringify([
      { id: 'c1', requirement: 'The evidence explicitly contains the phrase CONTENT BOUNTY LIVE PASS.' },
      { id: 'c2', requirement: 'The evidence links to https://docs.genlayer.com/.' },
    ])

    async function postAndFind(title) {
      await writeAndFinalize(deployerClient, deployer, chain, proof, checkpoint, {
        address,
        functionName: 'post_bounty',
        args: [title, 'Live consensus integration evidence.', rubric, 3600, 3600],
        value: reward,
      }, `post ${title}`)
      const bounties = await readAll(deployerClient, address, 'get_bounties_page')
      return Number(bounties.at(-1).id)
    }

    async function submitAndFind(bountyId, uri, label) {
      await writeAndFinalize(creatorClient, creator, chain, proof, checkpoint, {
        address,
        functionName: 'submit_content',
        args: [bountyId, uri],
      }, label)
      const activity = await readAll(
        creatorClient,
        address,
        'get_creator_submissions_page',
        [creator.address],
      )
      return Number(activity.at(-1).id)
    }

    async function evaluateAndRead(submissionId, label) {
      await writeAndFinalize(deployerClient, deployer, chain, proof, checkpoint, {
        address,
        functionName: 'evaluate_submission',
        args: [submissionId],
      }, label)
      return deployerClient.readContract({
        address,
        functionName: 'get_submission',
        args: [submissionId],
      })
    }

    const rejectBounty = await postAndFind('Live clear rejection')
    const rejectSubmission = await submitAndFind(
      rejectBounty,
      process.env.LIVE_REJECT_EVIDENCE_URI,
      'submit clear rejection evidence',
    )
    const rejectedCommitment = await creatorClient.readContract({
      address,
      functionName: 'get_submission',
      args: [rejectSubmission],
    })
    const commitmentVerification = classifyOnChainAdversarialCommitment(
      adversarialFixture,
      rejectedCommitment.evidence_sha256,
    )
    proof.adversarialRejectionFixture.observedOnChainSha256 = commitmentVerification.observedOnChainSha256
    proof.adversarialRejectionFixture.verified = commitmentVerification.verified
    proof.completionChecks.adversarialRejectionVerified = commitmentVerification.verified
    updateProofCompletion(proof)
    checkpoint()
    if (!proof.adversarialRejectionFixture.verified) {
      throw new Error(
        `Hosted adversarial rejection fixture hash mismatch: expected ${adversarialFixture.expectedNormalizedSha256}, got ${commitmentVerification.observedOnChainSha256 || 'MISSING'}`,
      )
    }
    const rejected = await evaluateAndRead(rejectSubmission, 'evaluate clear rejection')
    if (rejected.status !== 'REJECTED') throw new Error(`Expected REJECTED, got ${rejected.status}`)
    proof.scenarios.clearRejection = {
      submission: rejected,
      adversarialFixture: { ...proof.adversarialRejectionFixture },
    }
    proof.completionChecks.clearRejection = true
    updateProofCompletion(proof)
    checkpoint()

    const mutableBounty = await postAndFind('Live mutation inconclusive')
    const mutableSubmission = await submitAndFind(
      mutableBounty,
      process.env.LIVE_MUTABLE_EVIDENCE_URI,
      'submit mutable evidence',
    )
    const mutationResponse = await fetch(process.env.LIVE_MUTATION_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uri: process.env.LIVE_MUTABLE_EVIDENCE_URI }),
    })
    if (!mutationResponse.ok) throw new Error(`Mutation webhook failed with ${mutationResponse.status}`)
    const inconclusive = await evaluateAndRead(mutableSubmission, 'evaluate mutated evidence')
    if (
      inconclusive.status !== 'INCONCLUSIVE'
      || !['DIGEST_MISMATCH', 'FETCH_FAILED'].includes(inconclusive.reason_code)
    ) {
      throw new Error(`Expected mutation inconclusive, got ${inconclusive.status}/${inconclusive.reason_code}`)
    }
    proof.scenarios.inconclusiveMutation = inconclusive
    proof.completionChecks.mutationInconclusive = true
    updateProofCompletion(proof)
    checkpoint()

    const approveBounty = await postAndFind('Live clear approval and payout')
    const approveSubmission = await submitAndFind(
      approveBounty,
      process.env.LIVE_APPROVE_EVIDENCE_URI,
      'submit clear approval evidence',
    )
    const balanceBefore = await creatorClient.getBalance({ address: creator.address })
    const approved = await evaluateAndRead(approveSubmission, 'evaluate clear approval')
    const balanceAfter = await creatorClient.getBalance({ address: creator.address })
    const balanceDelta = balanceAfter - balanceBefore
    if (approved.status !== 'APPROVED') throw new Error(`Expected APPROVED, got ${approved.status}`)
    const deltaMatchesReward = balanceDelta === reward
    if (proofMode.persistent && !deltaMatchesReward) {
      throw new Error(`Expected finalized payout delta ${reward}, got ${balanceDelta}`)
    }
    proof.persistentPayoutProofValid = proofMode.persistent
      && proofMode.persistentPayoutProofEligible
      && deltaMatchesReward
    proof.scenarios.clearApproval = approved
    proof.scenarios.finalizedPayout = {
      recipient: creator.address,
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
      balanceDelta: balanceDelta.toString(),
      expectedReward: reward.toString(),
      deltaMatchesReward,
      balancesSimulated: proofMode.balancesSimulated,
      persistentProofValid: proof.persistentPayoutProofValid,
      qualification: proofMode.balancesSimulated
        ? 'Studionet balances and transfers are simulated; this observation cannot satisfy the persistent payout-proof gate.'
        : 'Persistent payout proof requires this exact delta and successful finalized lifecycle classification.',
    }
    proof.completionChecks.clearApprovalFinalized = true
    proof.completionChecks.persistentPayoutDelta = proof.persistentPayoutProofValid
    updateProofCompletion(proof)
    checkpoint()

    if (proofMode.persistent && !proof.proofComplete) {
      throw new Error('Persistent proof is incomplete: deployment, adversarial rejection fixture, rejection, mutation, approval, and payout checks must all pass.')
    }
    proof.status = 'COMPLETE'
    updateProofCompletion(proof)
    checkpoint()
    console.log(proofJson({ output, ...proof }))
    return proof
  } catch (error) {
    recordProofFailure(output, proof, error)
    throw error
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Live consensus integration failed:', error?.message ?? error)
    process.exitCode = 1
  })
}
