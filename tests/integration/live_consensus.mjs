import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAccount, createClient } from 'genlayer-js'
import { selectGenLayerNetwork } from '../../scripts/genlayer-network.mjs'
import {
  classifyOnChainAdversarialCommitment,
  loadCommittedLiveAdversarialFixture,
} from '../../scripts/live-adversarial-fixture.mjs'
import {
  recoverFinalizedDeployment,
  validateRecoveryProofArtifact,
} from '../../scripts/live-deployment-recovery.mjs'
import { waitForLiveLifecycle } from '../../scripts/live-lifecycle.mjs'
import { selectLiveProofMode } from '../../scripts/live-proof-mode.mjs'
import { preflightLiveRun } from '../../scripts/live-run-preflight.mjs'
import {
  checkpointProof,
  createProofArtifact,
  loadProofArtifact,
  proofJson,
  redactProofError,
  recordProofExternalBlocker,
  recordProofFailure,
  recordTransactionObservation,
  resumeProofArtifact,
  updateProofCompletion,
} from '../../scripts/live-proof-store.mjs'
import { beginMutation, confirmMutation, MUTATION_STATES, reconcileMutationState } from '../../scripts/live-mutation-state.mjs'
import {
  BRADBURY_SCENARIO_WINDOW_SECONDS,
  createScenarioRecord,
  replaceScenarioRecord,
  scenarioDeadlineAction,
  validateStoredBountyScenario,
  validateStoredSubmissionScenario,
} from '../../scripts/live-scenario-recovery.mjs'
import { isTransientRpcFailure } from '../../scripts/live-rpc-error.mjs'
import { assertSafeDeployerAccount } from '../../scripts/deployer-guard.mjs'
import {
  collectRunnerProvenance,
  DEPLOYED_SOURCE_COMMIT,
  selectDeployedSourceProvenance,
} from '../../scripts/live-provenance.mjs'

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

const RECOVERY_ADDRESS = 'LIVE_EXISTING_CONTRACT_ADDRESS'
const RECOVERY_TRANSACTION = 'LIVE_EXISTING_DEPLOYMENT_TRANSACTION'

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

function configuredRecovery() {
  const address = process.env[RECOVERY_ADDRESS]?.trim() || ''
  const transaction = process.env[RECOVERY_TRANSACTION]?.trim() || ''
  if (Boolean(address) !== Boolean(transaction)) {
    throw new Error(`${RECOVERY_ADDRESS} and ${RECOVERY_TRANSACTION} must be supplied together for recovery`)
  }
  return address && transaction ? { address, transaction } : null
}

function explorerBase(chain) {
  return chain.blockExplorers.default.url.replace(/\/$/, '')
}

function latestUsableTransaction(proof, label) {
  return [...proof.transactions].reverse().find((item) =>
    item.label === label
    && typeof item.hash === 'string'
    && item.status !== 'EVM_REVERTED_OR_NOT_PROCESSED'
    && item.observations?.at(-1)?.phase !== 'FAILED')
}

function scenarioTransaction(proof, hash, fallbackLabel) {
  if (hash) {
    const exact = proof.transactions.find((item) => item.hash?.toLowerCase() === hash.toLowerCase())
    if (!exact) throw new Error(`Stored transaction ${hash} is absent from the proof artifact`)
    return exact
  }
  return latestUsableTransaction(proof, fallbackLabel)
}

function recoverExistingScenarioRecords(proof) {
  const rejection = proof.scenarios.clearRejection?.submission
  if (!proof.scenarios.clearRejectionScenario && rejection) {
    proof.scenarios.clearRejectionScenario = {
      ...createScenarioRecord({
        scenarioKey: 'clear-rejection',
        baseTitle: 'Live clear rejection',
        evidenceUri: rejection.evidence_uri,
        generatedAt: proof.generatedAt,
      }),
      title: 'Live clear rejection',
      bountyId: Number(rejection.bounty_id),
      submissionId: Number(rejection.id),
      postTransaction: proof.transactions.find((item) => item.label === 'post Live clear rejection')?.hash ?? null,
      submissionTransaction: proof.transactions.find((item) => item.label === 'submit clear rejection evidence')?.hash ?? null,
      evaluationTransaction: proof.transactions.find((item) => item.label === 'evaluate clear rejection')?.hash ?? null,
    }
  }
  if (!proof.scenarios.mutationScenario && proof.transactions.some((item) => item.label === 'post Live mutation inconclusive')) {
    proof.scenarios.mutationScenario = {
      ...createScenarioRecord({
        scenarioKey: 'mutation',
        baseTitle: 'Live mutation inconclusive',
        evidenceUri: process.env.LIVE_MUTABLE_EVIDENCE_URI,
        generatedAt: proof.generatedAt,
      }),
      title: 'Live mutation inconclusive',
      bountyId: 1,
      submissionId: 1,
      postTransaction: proof.transactions.find((item) => item.label === 'post Live mutation inconclusive')?.hash ?? null,
      submissionTransaction: proof.transactions.filter((item) => item.label === 'submit mutable evidence').at(-1)?.hash ?? null,
    }
  }
  return proof
}

async function waitLifecycle(client, hash, label, chain, proof, checkpoint, existing = null) {
  const transactionProof = existing ?? {
    label,
    hash,
    explorer: `${explorerBase(chain)}/tx/${hash}`,
    observations: [],
    acceptedPhaseObserved: false,
    successfulFinalizationObserved: false,
    separateAcceptedAndFinalizedObservations: false,
  }
  if (!existing) proof.transactions.push(transactionProof)
  checkpoint()
  const lifecycle = await waitForLiveLifecycle({
    client,
    hash,
    acceptedOptions: { retries: 180, interval: 3000 },
    finalizedOptions: { retries: 360, interval: 5000 },
    onObservation: (observation) => {
      recordTransactionObservation(transactionProof, observation)
      checkpoint()
    },
    onTransientError: ({ attempt, retries, message }) => {
      transactionProof.observationErrors ??= []
      transactionProof.observationErrors.push({
        observedAt: new Date().toISOString(),
        attempt,
        retries,
        message,
      })
      checkpoint()
    },
  })
  transactionProof.successfulFinalizationObserved = lifecycle.successfulFinalizationObserved
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

async function latestChainTimestamp(client) {
  const block = await client.getBlock({ blockTag: 'latest' })
  const timestamp = Number(block?.timestamp)
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('Bradbury latest block timestamp is malformed')
  }
  return timestamp
}

async function writeAndFinalize(client, account, chain, proof, checkpoint, request, label) {
  try {
    const hash = await client.writeContract({ account, ...request })
    await waitLifecycle(client, hash, label, chain, proof, checkpoint)
    return hash
  } catch (error) {
    const message = error?.message ?? String(error)
    const evmHash = message.match(/EVM tx (0x[0-9a-fA-F]{64})/i)?.[1]
    if (evmHash && !proof.transactions.some((item) => item.hash?.toLowerCase() === evmHash.toLowerCase())) {
      proof.transactions.push({
        label,
        hash: evmHash,
        explorer: `${explorerBase(chain)}/tx/${evmHash}`,
        observations: [],
        acceptedPhaseObserved: false,
        successfulFinalizationObserved: false,
        separateAcceptedAndFinalizedObservations: false,
        status: 'EVM_REVERTED_OR_NOT_PROCESSED',
      })
      checkpoint()
    }
    throw error
  }
}

export async function main() {
  requiredEnvironment()
  const configuredNetwork = process.env.LIVE_GENLAYER_NETWORK.trim()
  const { name: network, chain } = selectGenLayerNetwork(configuredNetwork)
  const proofMode = selectLiveProofMode(network, process.env.LIVE_PROOF_MODE)
  const deployer = createAccount(process.env.LIVE_DEPLOYER_PRIVATE_KEY)
  const creator = createAccount(process.env.LIVE_CREATOR_PRIVATE_KEY)
  assertSafeDeployerAccount(deployer)
  assertSafeDeployerAccount(creator, 'creator signer')
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
  const recovery = configuredRecovery()
  const runner = collectRunnerProvenance()
  const sourceSha256 = createHash('sha256').update(code).digest('hex')
  const deployedSource = selectDeployedSourceProvenance({
    recovery,
    runnerCommit: runner.commit,
    sourceSha256,
  })
  const initialProof = {
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
    sourceCommit: deployedSource.commit,
    sourceSha256,
    deployedSource,
    runner,
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
  }
  const storedProof = recovery ? validateRecoveryProofArtifact(loadProofArtifact(output), {
    network,
    deploymentTransaction: recovery.transaction,
    contractAddress: recovery.address,
    sourceSha256: initialProof.sourceSha256,
    deployer: deployer.address,
    creator: creator.address,
  }) : null
  const proof = createProofArtifact(output, storedProof ? {
    ...initialProof,
    ...storedProof,
    status: 'RUNNING',
    failure: null,
    proofComplete: false,
    resumedAt: new Date().toISOString(),
  } : initialProof)
  proof.sourceCommit = deployedSource.commit
  proof.deployedSource = deployedSource
  proof.runner = runner
  if (storedProof) resumeProofArtifact(proof)
  recoverExistingScenarioRecords(proof)
  proof.scenarios.mutationState ??= {
    state: MUTATION_STATES.NOT_STARTED,
    mutableEvidenceUri: process.env.LIVE_MUTABLE_EVIDENCE_URI,
  }
  const checkpoint = () => checkpointProof(output, proof)

  try {
    if (proofMode.persistent) proof.preflight = await preflightLiveRun({
      network,
      proofMode: proofMode.mode,
      deployer,
      creator,
      deployerClient,
      creatorClient,
      reward,
      approvalUri: process.env.LIVE_APPROVE_EVIDENCE_URI,
      rejectionUri: process.env.LIVE_REJECT_EVIDENCE_URI,
      mutableUri: process.env.LIVE_MUTABLE_EVIDENCE_URI,
      mutationWebhookUrl: process.env.LIVE_MUTATION_WEBHOOK_URL,
      adversarialFixture,
      mutationCheckpoint: proof.scenarios.mutationState,
    })
    proof.scenarios.mutationState = proof.preflight.mutationState
    checkpoint()

    let address
    let deploymentHash
    if (recovery) {
      const recovered = await recoverFinalizedDeployment({
        client: deployerClient,
        deploymentTransaction: recovery.transaction,
        contractAddress: recovery.address,
        expectedSourceSha256: proof.sourceSha256,
      })
      address = recovered.contractAddress
      deploymentHash = recovered.transactionId
      const recoveredTransactionProof = proof.transactions.find((item) =>
        item.recovered && item.hash?.toLowerCase() === deploymentHash.toLowerCase())
      if (!recoveredTransactionProof) proof.transactions.push({
        label: 'recover v2.1.1 deployment',
        hash: deploymentHash,
        explorer: `${explorerBase(chain)}/tx/${deploymentHash}`,
        recovered: true,
        observations: [{
          observedAt: new Date().toISOString(),
          requestedStatus: 'RECOVERY_LOOKUP',
          phase: 'FINALIZED',
          terminal: true,
          statusName: recovered.lifecycle.statusName,
          resultName: recovered.lifecycle.resultName,
          executionResultName: recovered.lifecycle.executionResultName,
        }],
        acceptedPhaseObserved: false,
        successfulFinalizationObserved: true,
        separateAcceptedAndFinalizedObservations: false,
      })
      proof.recoveredDeployment = {
        transaction: deploymentHash,
        contractAddress: address,
        sourceSha256: recovered.sourceSha256,
        lifecycle: recovered.lifecycle,
      }
    } else {
      deploymentHash = await deployerClient.deployContract({ account: deployer, code, args: [] })
      const deploymentReceipt = await waitLifecycle(
        deployerClient,
        deploymentHash,
        'deploy v2.1.1',
        chain,
        proof,
        checkpoint,
      )
      address = deploymentReceipt?.data?.contract_address
        ?? deploymentReceipt?.contractAddress
        ?? deploymentReceipt?.result?.contract_address
      if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error('Finalized deployment receipt did not contain a contract address')
      }
    }
    proof.contractAddress = address
    proof.contractExplorer = `${explorerBase(chain)}/address/${address}`
    proof.scenarios.deployment = {
      hash: deploymentHash,
      explorer: `${explorerBase(chain)}/tx/${deploymentHash}`,
      address,
      finalized: true,
      recovered: Boolean(recovery),
      sourceSha256: proof.sourceSha256,
    }
    proof.completionChecks.deploymentFinalized = true
    updateProofCompletion(proof)
    checkpoint()

    const rubric = JSON.stringify([
      { id: 'c1', requirement: 'The evidence explicitly contains the phrase CONTENT BOUNTY LIVE PASS.' },
      { id: 'c2', requirement: 'The evidence links to https://docs.genlayer.com/.' },
    ])

    async function postScenario(scenario) {
      const existingBounties = await readAll(deployerClient, address, 'get_bounties_page')
      const existing = scenario.bountyId === null
        ? null
        : existingBounties.find((item) => Number(item.id) === Number(scenario.bountyId))
      if (existing) {
        validateStoredBountyScenario(scenario, existing, deployer.address)
        const transactionProof = scenarioTransaction(proof, scenario.postTransaction, `post ${scenario.title}`)
        if (!transactionProof) {
          throw new Error(`Bounty ${scenario.title} already exists but its post transaction is absent from the proof artifact`)
        }
        await waitLifecycle(
          deployerClient,
          transactionProof.hash,
          transactionProof.label,
          chain,
          proof,
          checkpoint,
          transactionProof,
        )
        return { ...scenario, ...existing, bountyId: Number(existing.id) }
      }
      await writeAndFinalize(deployerClient, deployer, chain, proof, checkpoint, {
        address,
        functionName: 'post_bounty',
        args: [scenario.title, 'Live consensus integration evidence.', rubric, BRADBURY_SCENARIO_WINDOW_SECONDS, BRADBURY_SCENARIO_WINDOW_SECONDS],
        value: reward,
      }, `post ${scenario.title}`)
      const bounties = await readAll(deployerClient, address, 'get_bounties_page')
      const created = bounties.find((item) => item.title === scenario.title && item.poster?.toLowerCase() === deployer.address.toLowerCase())
      if (!created) throw new Error(`Posted scenario ${scenario.title} was not found by exact title`)
      return { ...scenario, bountyId: Number(created.id), postTransaction: latestUsableTransaction(proof, `post ${scenario.title}`)?.hash ?? null }
    }

    async function submitScenario(scenario, label) {
      const existingActivity = await readAll(
        creatorClient,
        address,
        'get_creator_submissions_page',
        [creator.address],
      )
      const existing = scenario.submissionId === null
        ? null
        : existingActivity.find((item) => Number(item.id) === Number(scenario.submissionId))
      if (existing) {
        const transactionProof = scenarioTransaction(proof, scenario.submissionTransaction, label)
        if (!transactionProof) {
          throw new Error(`Submission for bounty ${scenario.bountyId} exists but its transaction is absent from the proof artifact`)
        }
        await waitLifecycle(
          creatorClient,
          transactionProof.hash,
          transactionProof.label,
          chain,
          proof,
          checkpoint,
          transactionProof,
        )
        validateStoredSubmissionScenario(scenario, existing, creator.address)
        return { ...scenario, submissionId: Number(existing.id) }
      }
      await writeAndFinalize(creatorClient, creator, chain, proof, checkpoint, {
        address,
        functionName: 'submit_content',
        args: [scenario.bountyId, scenario.evidenceUri],
      }, label)
      const activity = await readAll(
        creatorClient,
        address,
        'get_creator_submissions_page',
        [creator.address],
      )
      const created = activity.find((item) => Number(item.bounty_id) === Number(scenario.bountyId) && item.evidence_uri === scenario.evidenceUri)
      if (!created) throw new Error(`Submission for exact bounty ${scenario.bountyId} was not found`)
      return { ...scenario, submissionId: Number(created.id), submissionTransaction: latestUsableTransaction(proof, label)?.hash ?? null }
    }

    async function evaluateAndRead(submissionId, label) {
      const existingTransaction = latestUsableTransaction(proof, label)
      if (existingTransaction) {
        await waitLifecycle(
          deployerClient,
          existingTransaction.hash,
          existingTransaction.label,
          chain,
          proof,
          checkpoint,
          existingTransaction,
        )
        return deployerClient.readContract({
          address,
          functionName: 'get_submission',
          args: [submissionId],
        })
      }
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

    async function reconcileScenarioClosure(scenario, bountyState, action) {
      if (scenario.bountyId === null) return { scenario, bounty: bountyState, action }
      const closureLabel = action.action === 'CANCEL_AND_REPLACE'
        ? `cancel ${scenario.title}`
        : `expire ${scenario.title}`
      const closureTransaction = latestUsableTransaction(proof, closureLabel)
      if (closureTransaction) {
        await waitLifecycle(
          deployerClient,
          closureTransaction.hash,
          closureTransaction.label,
          chain,
          proof,
          checkpoint,
          closureTransaction,
        )
        const refreshedBounty = await deployerClient.readContract({
          address,
          functionName: 'get_bounty',
          args: [scenario.bountyId],
        })
        return {
          scenario,
          bounty: refreshedBounty,
          action: scenarioDeadlineAction({
            bounty: refreshedBounty,
            chainTimestamp: await latestChainTimestamp(deployerClient),
          }),
        }
      }
      return { scenario, bounty: bountyState, action }
    }

    function shouldReplaceClosedScenario(action) {
      return action.action === 'EXPIRE_AND_REPLACE'
        || (action.action === 'TERMINAL' && ['EXPIRED', 'CANCELLED'].includes(action.reason))
    }

    const rejectScenario = proof.scenarios.clearRejectionScenario
      ?? createScenarioRecord({ scenarioKey: 'clear-rejection', baseTitle: 'Live clear rejection', evidenceUri: process.env.LIVE_REJECT_EVIDENCE_URI, generatedAt: proof.generatedAt })
    const rejectRecord = await postScenario(rejectScenario)
    proof.scenarios.clearRejectionScenario = rejectRecord
    checkpoint()
    const rejectSubmissionRecord = await submitScenario({ ...rejectRecord, evidenceUri: process.env.LIVE_REJECT_EVIDENCE_URI }, 'submit clear rejection evidence')
    proof.scenarios.clearRejectionScenario = rejectSubmissionRecord
    const rejectSubmission = rejectSubmissionRecord.submissionId
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

    const mutableScenario = proof.scenarios.mutationScenario
      ?? createScenarioRecord({ scenarioKey: 'mutation', baseTitle: 'Live mutation inconclusive', evidenceUri: process.env.LIVE_MUTABLE_EVIDENCE_URI, generatedAt: proof.generatedAt })
    let mutableRecord = mutableScenario
    if (mutableRecord.bountyId !== null) {
      const mutableBountyState = await deployerClient.readContract({ address, functionName: 'get_bounty', args: [mutableRecord.bountyId] })
      const mutableSubmissionState = mutableRecord.submissionId === null ? null : await creatorClient.readContract({ address, functionName: 'get_submission', args: [mutableRecord.submissionId] })
      mutableRecord = validateStoredBountyScenario(mutableRecord, mutableBountyState, deployer.address)
      if (mutableSubmissionState) mutableRecord = validateStoredSubmissionScenario(mutableRecord, mutableSubmissionState, creator.address)
      let action = scenarioDeadlineAction({ bounty: mutableBountyState, submission: mutableSubmissionState, chainTimestamp: await latestChainTimestamp(deployerClient) })
      const reconciled = await reconcileScenarioClosure(mutableRecord, mutableBountyState, action)
      mutableRecord = reconciled.scenario
      action = reconciled.action
      if (shouldReplaceClosedScenario(action)) {
        if (action.action === 'EXPIRE_AND_REPLACE') {
        await writeAndFinalize(deployerClient, deployer, chain, proof, checkpoint, { address, functionName: 'expire_bounty', args: [mutableRecord.bountyId] }, `expire ${mutableRecord.title}`)
        }
        mutableRecord = replaceScenarioRecord({ ...mutableRecord, status: 'EXPIRED', replacementReason: action.reason }, new Date().toISOString())
      } else if (action.action !== 'REUSE') {
        throw new Error(`Stored mutable scenario cannot resume: ${action.reason}`)
      }
    }
    if (mutableRecord.bountyId === null) mutableRecord = await postScenario(mutableRecord)
    if (mutableRecord.submissionId === null) mutableRecord = await submitScenario(mutableRecord, 'submit mutable evidence')
    proof.scenarios.mutationScenario = mutableRecord
    checkpoint()
    const mutationCheckpoint = proof.preflight?.mutationState
      ?? reconcileMutationState(proof.scenarios.mutationState, proof.preflight?.health?.mutableState ?? 'initial', process.env.LIVE_MUTABLE_EVIDENCE_URI)
    if (mutationCheckpoint.state !== MUTATION_STATES.CONFIRMED) {
      proof.scenarios.mutationState = beginMutation(mutationCheckpoint, process.env.LIVE_MUTABLE_EVIDENCE_URI)
      checkpoint()
      const mutationResponse = await fetch(process.env.LIVE_MUTATION_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uri: process.env.LIVE_MUTABLE_EVIDENCE_URI }),
      })
      if (!mutationResponse.ok) throw new Error(`Mutation webhook failed with ${mutationResponse.status}`)
      proof.scenarios.mutationState = confirmMutation(proof.scenarios.mutationState, process.env.LIVE_MUTABLE_EVIDENCE_URI)
      proof.scenarios.mutationWebhook = { ...proof.scenarios.mutationState }
      checkpoint()
    }
    const inconclusive = await evaluateAndRead(mutableRecord.submissionId, 'evaluate mutated evidence')
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

    const approvalScenario = proof.scenarios.approvalScenario
      ?? createScenarioRecord({ scenarioKey: 'clear-approval', baseTitle: 'Live clear approval and payout', evidenceUri: process.env.LIVE_APPROVE_EVIDENCE_URI, generatedAt: proof.generatedAt })
    let approvalRecord = approvalScenario
    if (approvalRecord.bountyId !== null) {
      const approvalBountyState = await deployerClient.readContract({ address, functionName: 'get_bounty', args: [approvalRecord.bountyId] })
      const approvalSubmissionState = approvalRecord.submissionId === null ? null : await creatorClient.readContract({ address, functionName: 'get_submission', args: [approvalRecord.submissionId] })
      approvalRecord = validateStoredBountyScenario(approvalRecord, approvalBountyState, deployer.address)
      if (approvalSubmissionState) approvalRecord = validateStoredSubmissionScenario(approvalRecord, approvalSubmissionState, creator.address)
      let action = scenarioDeadlineAction({ bounty: approvalBountyState, submission: approvalSubmissionState, chainTimestamp: await latestChainTimestamp(deployerClient) })
      const reconciled = await reconcileScenarioClosure(approvalRecord, approvalBountyState, action)
      approvalRecord = reconciled.scenario
      action = reconciled.action
      if (shouldReplaceClosedScenario(action)) {
        if (action.action === 'EXPIRE_AND_REPLACE') {
        await writeAndFinalize(deployerClient, deployer, chain, proof, checkpoint, { address, functionName: 'expire_bounty', args: [approvalRecord.bountyId] }, `expire ${approvalRecord.title}`)
        }
        approvalRecord = replaceScenarioRecord({ ...approvalRecord, status: 'EXPIRED', replacementReason: action.reason }, new Date().toISOString())
      } else if (action.action === 'CANCEL_AND_REPLACE') {
        await writeAndFinalize(deployerClient, deployer, chain, proof, checkpoint, { address, functionName: 'cancel_bounty', args: [approvalRecord.bountyId] }, `cancel ${approvalRecord.title}`)
        approvalRecord = replaceScenarioRecord({ ...approvalRecord, status: 'CANCELLED', replacementReason: action.reason }, new Date().toISOString())
      } else if (action.action !== 'REUSE') {
        throw new Error(`Stored approval scenario cannot resume: ${action.reason}`)
      }
    }
    if (approvalRecord.bountyId === null) approvalRecord = await postScenario(approvalRecord)
    approvalRecord = await submitScenario(approvalRecord, 'submit clear approval evidence')
    proof.scenarios.approvalScenario = approvalRecord
    const approveSubmission = approvalRecord.submissionId
    if (!proof.scenarios.approvalPayoutBaseline) {
      const balanceBefore = await creatorClient.getBalance({ address: creator.address })
      proof.scenarios.approvalPayoutBaseline = {
        recipient: creator.address,
        balanceBefore: balanceBefore.toString(),
        recordedAt: new Date().toISOString(),
      }
      checkpoint()
    }
    const approved = await evaluateAndRead(approveSubmission, 'evaluate clear approval')
    const balanceAfter = await creatorClient.getBalance({ address: creator.address })
    const balanceBefore = BigInt(proof.scenarios.approvalPayoutBaseline.balanceBefore)
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
    if (isTransientRpcFailure(error)) recordProofExternalBlocker(output, proof, error)
    else recordProofFailure(output, proof, error)
    throw error
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Live consensus integration failed:', redactProofError(error))
    process.exitCode = 1
  })
}
