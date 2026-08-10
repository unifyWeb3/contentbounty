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
  replaceTerminallyFailedPostScenario,
  replaceScenarioRecord,
  scenarioDeadlineAction,
  validateLiveBountyScenario,
  validateStoredSubmissionScenario,
} from '../../scripts/live-scenario-recovery.mjs'
import { isTransientRpcFailure } from '../../scripts/live-rpc-error.mjs'
import { assertSafeDeployerAccount } from '../../scripts/deployer-guard.mjs'
import {
  collectRunnerProvenance,
  selectDeployedSourceProvenance,
} from '../../scripts/live-provenance.mjs'
import {
  ensureDeadlineSafeScenarioSubmission,
  ensureScenarioBounty,
  ensureScenarioClosure,
  ensureScenarioEvaluation,
  ensureScenarioSubmission,
} from '../../scripts/live-scenario-executor.mjs'

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

function uniqueUsableTransaction(proof, label) {
  const matches = proof.transactions.filter((item) =>
    item.label === label
    && typeof item.hash === 'string'
    && item.status !== 'EVM_REVERTED_OR_NOT_PROCESSED'
    && item.observations?.at(-1)?.phase !== 'FAILED')
  if (matches.length > 1) throw new Error(`Multiple usable transactions match recovery label ${label}`)
  return matches[0] ?? null
}

function exactScenarioTransaction(proof, hash, label) {
  const transaction = proof.transactions.find((item) => item.hash?.toLowerCase() === hash.toLowerCase())
  if (!transaction) throw new Error(`Stored transaction ${hash} is absent from the proof artifact`)
  if (transaction.label !== label) {
    throw new Error(`Stored transaction ${hash} label ${transaction.label || 'MISSING'} does not match ${label}`)
  }
  if (transaction.status === 'EVM_REVERTED_OR_NOT_PROCESSED' || transaction.observations?.at(-1)?.phase === 'FAILED') {
    throw new Error(`Stored transaction ${hash} is failed and cannot recover ${label}`)
  }
  return transaction
}

export function recoverExistingScenarioRecords(proof, mutableEvidenceUri = process.env.LIVE_MUTABLE_EVIDENCE_URI) {
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
      bountyId: null,
      submissionId: null,
      postTransaction: proof.transactions.find((item) => item.label === 'post Live clear rejection')?.hash ?? null,
      submissionTransaction: proof.transactions.find((item) => item.label === 'submit clear rejection evidence')?.hash ?? null,
      evaluationTransaction: proof.transactions.find((item) => item.label === 'evaluate clear rejection')?.hash ?? null,
    }
  }
  if (!proof.scenarios.mutationScenario && proof.transactions.some((item) => item.label === 'post Live mutation inconclusive')) {
    const closureTransaction = uniqueUsableTransaction(proof, 'expire Live mutation inconclusive')
    proof.scenarios.mutationScenario = {
      ...createScenarioRecord({
        scenarioKey: 'mutation',
        baseTitle: 'Live mutation inconclusive',
        evidenceUri: mutableEvidenceUri,
        generatedAt: proof.generatedAt,
      }),
      title: 'Live mutation inconclusive',
      bountyId: null,
      submissionId: null,
      postTransaction: proof.transactions.find((item) => item.label === 'post Live mutation inconclusive')?.hash ?? null,
      submissionTransaction: proof.transactions.filter((item) => item.label === 'submit mutable evidence').at(-1)?.hash ?? null,
      closureAction: closureTransaction ? 'EXPIRE' : null,
      closureTransaction: closureTransaction?.hash ?? null,
    }
  }
  const mutationScenario = proof.scenarios.mutationScenario
  if (mutationScenario && !mutationScenario.closureTransaction) {
    const closureTransaction = uniqueUsableTransaction(proof, `expire ${mutationScenario.title}`)
    if (closureTransaction) {
      proof.scenarios.mutationScenario = {
        ...mutationScenario,
        closureAction: 'EXPIRE',
        closureTransaction: closureTransaction.hash,
      }
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

async function submitWrite(client, account, chain, proof, checkpoint, request, label, onSubmitted = () => {}) {
  try {
    const hash = await client.writeContract({ account, ...request })
    if (!proof.transactions.some((item) => item.hash?.toLowerCase() === hash.toLowerCase())) {
      proof.transactions.push({
        label,
        hash,
        explorer: `${explorerBase(chain)}/tx/${hash}`,
        observations: [],
        acceptedPhaseObserved: false,
        successfulFinalizationObserved: false,
        separateAcceptedAndFinalizedObservations: false,
        accepted: null,
        finalized: null,
      })
    }
    onSubmitted(hash)
    checkpoint()
    return { hash, label }
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
  const loadedProof = loadProofArtifact(output)
  const storedProof = recovery ? validateRecoveryProofArtifact(loadedProof, {
    network,
    deploymentTransaction: recovery.transaction,
    contractAddress: recovery.address,
    sourceSha256,
    deployer: deployer.address,
    creator: creator.address,
  }) : null
  if (recovery && !storedProof?.deployedSource?.commit && !storedProof?.sourceCommit) {
    throw new Error('Recovery proof artifact lacks deployment-time source commit provenance')
  }
  const deployedSource = selectDeployedSourceProvenance({
    storedProof,
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

    function scenarioProofKey(scenario) {
      if (scenario.scenarioKey === 'clear-rejection') return 'clearRejectionScenario'
      if (scenario.scenarioKey === 'mutation') return 'mutationScenario'
      if (scenario.scenarioKey === 'clear-approval') return 'approvalScenario'
      throw new Error(`Unknown scenario key ${scenario.scenarioKey}`)
    }

    function checkpointScenarioRecord(scenario) {
      const expectedEvidenceUri = scenario.scenarioKey === 'clear-rejection'
        ? process.env.LIVE_REJECT_EVIDENCE_URI
        : scenario.scenarioKey === 'mutation'
          ? process.env.LIVE_MUTABLE_EVIDENCE_URI
          : process.env.LIVE_APPROVE_EVIDENCE_URI
      if (scenario.evidenceUri !== expectedEvidenceUri) {
        throw new Error(`Stored ${scenario.scenarioKey} evidence URI does not match configured evidence URI`)
      }
      proof.scenarios[scenarioProofKey(scenario)] = scenario
      checkpoint()
    }

    function validateConfiguredBountyScenario(scenario, bounty) {
      const expectedEvidenceUri = scenario.scenarioKey === 'clear-rejection'
        ? process.env.LIVE_REJECT_EVIDENCE_URI
        : scenario.scenarioKey === 'mutation'
          ? process.env.LIVE_MUTABLE_EVIDENCE_URI
          : process.env.LIVE_APPROVE_EVIDENCE_URI
      return validateLiveBountyScenario(scenario, bounty, deployer.address, {
        reward,
        evidenceUri: expectedEvidenceUri,
        description: 'Live consensus integration evidence.',
        rubricJson: rubric,
        rubricVersion: 'content-bounty-rubric-v2',
      })
    }

    function transactionForScenario(hash, label) {
      if (hash) {
        return exactScenarioTransaction(proof, hash, label)
      }
      return uniqueUsableTransaction(proof, label)
    }

    async function waitScenarioTransaction(client, transaction, label) {
      const existing = proof.transactions.find((item) =>
        item.hash?.toLowerCase() === transaction.hash.toLowerCase())
      return waitLifecycle(
        client,
        transaction.hash,
        existing?.label ?? transaction.label ?? label,
        chain,
        proof,
        checkpoint,
        existing ?? null,
      )
    }

    async function postScenario(scenario) {
      checkpointScenarioRecord(scenario)
      if (scenario.bountyId !== null) {
        if (!scenario.postTransaction) {
          throw new Error(`Stored bounty ${scenario.title} has no post transaction; refusing ambiguous recovery`)
        }
        await waitScenarioTransaction(
          deployerClient,
          transactionForScenario(scenario.postTransaction, `post ${scenario.title}`),
          `post ${scenario.title}`,
        )
        const existing = await deployerClient.readContract({
          address,
          functionName: 'get_bounty',
          args: [scenario.bountyId],
        })
        scenario = validateConfiguredBountyScenario(scenario, existing)
        checkpointScenarioRecord(scenario)
        return scenario
      }
      const label = `post ${scenario.title}`
      try {
        return await ensureScenarioBounty({
          scenario,
          listBounties: () => readAll(deployerClient, address, 'get_bounties_page'),
          poster: deployer.address,
          findTransaction: (hash) => transactionForScenario(hash, label),
          findStoredTransaction: () => transactionForScenario(null, label),
          waitTransaction: (transaction) => waitScenarioTransaction(deployerClient, transaction, label),
          submitPost: () => submitWrite(deployerClient, deployer, chain, proof, checkpoint, {
            address,
            functionName: 'post_bounty',
            args: [scenario.title, 'Live consensus integration evidence.', rubric, BRADBURY_SCENARIO_WINDOW_SECONDS, BRADBURY_SCENARIO_WINDOW_SECONDS],
            value: reward,
          }, label, (hash) => {
            proof.scenarios[scenarioProofKey(scenario)] = { ...scenario, postTransaction: hash }
          }),
          checkpointScenario: checkpointScenarioRecord,
        })
      } catch (error) {
        const checkpointed = proof.scenarios[scenarioProofKey(scenario)]
        const transaction = checkpointed?.postTransaction
          ? proof.transactions.find((item) =>
            item.hash?.toLowerCase() === checkpointed.postTransaction.toLowerCase())
          : null
        const replacement = transaction
          ? replaceTerminallyFailedPostScenario(
            checkpointed,
            transaction,
            new Date().toISOString(),
          )
          : null
        if (!replacement) throw error
        if (replacement.history.length > 8) {
          throw new Error(`Post failure replacement limit exceeded for ${scenario.scenarioKey}`)
        }
        checkpointScenarioRecord(replacement)
        return postScenario(replacement)
      }
    }

    async function submitScenario(scenario, label) {
      checkpointScenarioRecord(scenario)
      if (scenario.submissionId !== null) {
        if (!scenario.submissionTransaction) {
          throw new Error(`Stored submission ${scenario.submissionId} has no submission transaction; refusing ambiguous recovery`)
        }
        await waitScenarioTransaction(
          creatorClient,
          transactionForScenario(scenario.submissionTransaction, label),
          label,
        )
        const existing = await creatorClient.readContract({
          address,
          functionName: 'get_submission',
          args: [scenario.submissionId],
        })
        scenario = validateStoredSubmissionScenario(scenario, existing, creator.address)
        checkpointScenarioRecord(scenario)
        return scenario
      }
      return ensureScenarioSubmission({
        scenario,
        listSubmissions: () => readAll(
          creatorClient,
          address,
          'get_creator_submissions_page',
          [creator.address],
        ),
        creator: creator.address,
        findTransaction: (hash) => transactionForScenario(hash, label),
        findStoredTransaction: () => transactionForScenario(null, label),
        waitTransaction: (transaction) => waitScenarioTransaction(creatorClient, transaction, label),
        submitContent: () => submitWrite(creatorClient, creator, chain, proof, checkpoint, {
          address,
          functionName: 'submit_content',
          args: [scenario.bountyId, scenario.evidenceUri],
        }, label, (hash) => {
          proof.scenarios[scenarioProofKey(scenario)] = { ...scenario, submissionTransaction: hash }
        }),
        checkpointScenario: checkpointScenarioRecord,
      })
    }

    async function evaluateScenario(scenario, label) {
      const result = await ensureScenarioEvaluation({
        scenario,
        findTransaction: (hash) => hash ? transactionForScenario(hash, label) : null,
        waitTransaction: (transaction) => waitScenarioTransaction(deployerClient, transaction, label),
        submitEvaluation: () => submitWrite(deployerClient, deployer, chain, proof, checkpoint, {
          address,
          functionName: 'evaluate_submission',
          args: [scenario.submissionId],
        }, label, (hash) => {
          proof.scenarios[scenarioProofKey(scenario)] = { ...scenario, evaluationTransaction: hash }
        }),
        readSubmission: () => deployerClient.readContract({
          address,
          functionName: 'get_submission',
          args: [scenario.submissionId],
        }),
        checkpointScenario: checkpointScenarioRecord,
      })
      checkpointScenarioRecord(result.scenario)
      return result
    }

    async function reconcileScenarioClosure(scenario, bountyState, action) {
      if (scenario.bountyId === null) return { scenario, bounty: bountyState, action }
      const closureAction = action.action === 'CANCEL_AND_REPLACE' || action.reason === 'CANCELLED'
        ? 'CANCEL'
        : 'EXPIRE'
      const closureLabel = closureAction === 'CANCEL'
        ? `cancel ${scenario.title}`
        : `expire ${scenario.title}`
      const needsClosure = action.action === 'EXPIRE_AND_REPLACE'
        || action.action === 'CANCEL_AND_REPLACE'
        || (action.action === 'TERMINAL' && ['EXPIRED', 'CANCELLED'].includes(action.reason))
      if (needsClosure) {
        const closedScenario = await ensureScenarioClosure({
          scenario,
          action: closureAction,
          findTransaction: (hash) => transactionForScenario(hash, closureLabel),
          findStoredTransaction: () => transactionForScenario(null, closureLabel),
          waitTransaction: (transaction) => waitScenarioTransaction(deployerClient, transaction, closureLabel),
          submitClosure: action.action === 'TERMINAL' ? null : () => submitWrite(
            deployerClient,
            deployer,
            chain,
            proof,
            checkpoint,
            {
              address,
              functionName: closureAction === 'CANCEL' ? 'cancel_bounty' : 'expire_bounty',
              args: [scenario.bountyId],
            },
            closureLabel,
            (hash) => {
              proof.scenarios[scenarioProofKey(scenario)] = {
                ...scenario,
                closureAction,
                closureTransaction: hash,
              }
            },
          ),
          checkpointScenario: checkpointScenarioRecord,
        })
        const refreshedBounty = await deployerClient.readContract({
          address,
          functionName: 'get_bounty',
          args: [closedScenario.bountyId],
        })
        return {
          scenario: closedScenario,
          bounty: refreshedBounty,
          action: scenarioDeadlineAction({
            bounty: refreshedBounty,
            chainTimestamp: await latestChainTimestamp(deployerClient),
          }),
        }
      }
      return { scenario, bounty: bountyState, action }
    }

    async function ensureDeadlineSafeSubmission(scenario, label) {
      return ensureDeadlineSafeScenarioSubmission({
        scenario,
        ensureBounty: postScenario,
        ensureSubmission: (record) => submitScenario(record, label),
        readBounty: (bountyId) => deployerClient.readContract({
          address,
          functionName: 'get_bounty',
          args: [bountyId],
        }),
        validateBounty: validateConfiguredBountyScenario,
        readSubmission: (submissionId) => creatorClient.readContract({
          address,
          functionName: 'get_submission',
          args: [submissionId],
        }),
        validateSubmission: (record, submission) => validateStoredSubmissionScenario(
          record,
          submission,
          creator.address,
        ),
        readChainTimestamp: () => latestChainTimestamp(deployerClient),
        classifyDeadline: scenarioDeadlineAction,
        reconcileClosure: reconcileScenarioClosure,
        replaceScenario: (record) => replaceScenarioRecord(record, new Date().toISOString()),
        checkpointScenario: checkpointScenarioRecord,
      })
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
    const rejectedEvaluation = await evaluateScenario(rejectSubmissionRecord, 'evaluate clear rejection')
    proof.scenarios.clearRejectionScenario = rejectedEvaluation.scenario
    const rejected = rejectedEvaluation.submission
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
    let mutableRecord = await ensureDeadlineSafeSubmission(mutableScenario, 'submit mutable evidence')
    checkpointScenarioRecord(mutableRecord)
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
    const mutationEvaluation = await evaluateScenario(mutableRecord, 'evaluate mutated evidence')
    mutableRecord = mutationEvaluation.scenario
    const inconclusive = mutationEvaluation.submission
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
    let approvalRecord = await ensureDeadlineSafeSubmission(
      approvalScenario,
      'submit clear approval evidence',
    )
    checkpointScenarioRecord(approvalRecord)
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
    const approvalEvaluation = await evaluateScenario(approvalRecord, 'evaluate clear approval')
    approvalRecord = approvalEvaluation.scenario
    const approved = approvalEvaluation.submission
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
