import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { loadCommittedLiveAdversarialFixture } from './live-adversarial-fixture.mjs'

export const PUBLIC_PROOF_SCHEMA_VERSION = 'contentbounty-bradbury-persistent-proof-v1'
export const AUTHORITATIVE_CONTRACT_ADDRESS = '0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04'
export const AUTHORITATIVE_DEPLOYMENT_TRANSACTION = '0x6834512f8a6ad9bab36c9954477d9911617c6a097f6eaff33315bfddc8384d93'
export const DEPLOYED_SOURCE_COMMIT = 'c5c64c1ef007fa9b06d96aaa9255fe7322e6d356'
export const DEPLOYED_SOURCE_SHA256 = 'd19d74e60d5c869688690c2742bb4cd3875daafabb45ca0bfc994fbefd786ed7'
export const EXPECTED_PAYOUT_WEI = '1000000000000000'
export const BRADBURY_EXPLORER = 'https://explorer-bradbury.genlayer.com'

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))
const DEFAULT_RAW_PROOF = '/tmp/contentbounty-live-consensus-proof.json'
const DEFAULT_PUBLIC_PROOF = resolve(REPOSITORY_ROOT, 'docs/proofs/bradbury-persistent-proof-v1.json')
const REQUIRED_COMPLETION_CHECKS = Object.freeze([
  'deploymentFinalized',
  'clearRejection',
  'adversarialRejectionVerified',
  'mutationInconclusive',
  'clearApprovalFinalized',
  'persistentPayoutDelta',
])
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const TRANSACTION_PATTERN = /^0x[0-9a-fA-F]{64}$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SUCCESS_RESULTS = new Set(['AGREE', 'MAJORITY_AGREE'])

function fail(message) {
  throw new Error(`Live proof validation failed: ${message}`)
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual ?? 'MISSING'}`)
}

function requireCaseInsensitive(actual, expected, label) {
  if (typeof actual !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`${label}: expected ${expected}, got ${actual ?? 'MISSING'}`)
  }
}

function requirePattern(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} is malformed`)
  return value
}

function requirePublicHttpsUrl(value, label) {
  if (typeof value !== 'string') fail(`${label} is missing`)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`${label} is malformed`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search) {
    fail(`${label} must be a public HTTPS URL without authentication or query parameters`)
  }
  return value
}

function transactionExplorer(hash) {
  return `${BRADBURY_EXPLORER}/tx/${hash}`
}

function contractExplorer(address) {
  return `${BRADBURY_EXPLORER}/address/${address}`
}

function normalizedLifecycleObservation(observation) {
  const phase = typeof observation?.phase === 'string' ? observation.phase.toUpperCase() : ''
  const statusName = typeof observation?.statusName === 'string' ? observation.statusName.toUpperCase() : ''
  const resultName = typeof observation?.resultName === 'string' ? observation.resultName.toUpperCase() : ''
  const executionResultName = typeof observation?.executionResultName === 'string'
    ? observation.executionResultName.toUpperCase()
    : ''
  return { phase, statusName, resultName, executionResultName }
}

function successfulFinalization(observation) {
  const lifecycle = normalizedLifecycleObservation(observation)
  return lifecycle.phase === 'FINALIZED'
    && lifecycle.statusName === 'FINALIZED'
    && SUCCESS_RESULTS.has(lifecycle.resultName)
    && lifecycle.executionResultName === 'FINISHED_WITH_RETURN'
}

function publicObservation(observation) {
  const lifecycle = normalizedLifecycleObservation(observation)
  const result = {
    observedAt: observation.observedAt ?? null,
    requestedStatus: observation.requestedStatus ?? null,
    phase: lifecycle.phase || null,
    terminal: Boolean(observation.terminal),
    statusName: lifecycle.statusName || null,
    resultName: lifecycle.resultName || null,
    executionResultName: lifecycle.executionResultName || null,
  }
  if (typeof observation.failureReason === 'string' && observation.failureReason.trim()) {
    result.failureReason = observation.failureReason.trim()
  }
  return result
}

function assertNoSecretBearingValues(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretBearingValues(item, [...path, String(index)]))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/(private.?key|mutation.?token|secret|password|credential)/i.test(key) && item != null) {
        fail(`secret-bearing field is present at ${[...path, key].join('.')}`)
      }
      assertNoSecretBearingValues(item, [...path, key])
    }
    return
  }
  if (typeof value !== 'string') return
  if (/LIVE_(?:DEPLOYER|CREATOR)_PRIVATE_KEY|MUTATION_TOKEN/i.test(value)) {
    fail(`secret-bearing text is present at ${path.join('.')}`)
  }
  if (/^https:\/\//i.test(value)) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      fail(`malformed HTTPS URL at ${path.join('.')}`)
    }
    if (parsed.username || parsed.password || parsed.search) {
      fail(`authenticated or query-bearing URL is present at ${path.join('.')}`)
    }
  }
}

function assertConvenienceFields(transaction) {
  const observations = Array.isArray(transaction.observations) ? transaction.observations : []
  const accepted = observations.find((item) => item?.phase === 'ACCEPTED') ?? null
  const finalized = observations.find((item) => item?.phase === 'FINALIZED') ?? null
  const expected = {
    accepted,
    finalized,
    acceptedPhaseObserved: Boolean(accepted),
    successfulFinalizationObserved: Boolean(finalized),
    separateAcceptedAndFinalizedObservations: Boolean(accepted && finalized),
  }
  for (const field of ['acceptedPhaseObserved', 'successfulFinalizationObserved', 'separateAcceptedAndFinalizedObservations']) {
    requireEqual(transaction[field], expected[field], `${transaction.label || transaction.hash} ${field}`)
  }
  if (!isDeepStrictEqual(transaction.accepted ?? null, expected.accepted)) {
    fail(`${transaction.label || transaction.hash} accepted convenience observation is inconsistent`)
  }
  if (!isDeepStrictEqual(transaction.finalized ?? null, expected.finalized)) {
    fail(`${transaction.label || transaction.hash} finalized convenience observation is inconsistent`)
  }
  if (finalized && !successfulFinalization(finalized)) {
    fail(`${transaction.label || transaction.hash} has an unsuccessful FINALIZED observation`)
  }
}

function validateTransactionCollection(proof) {
  if (!Array.isArray(proof.transactions) || !proof.transactions.length) fail('transaction history is missing')
  const byHash = new Map()
  for (const transaction of proof.transactions) {
    const hash = requirePattern(transaction.hash, TRANSACTION_PATTERN, 'transaction hash').toLowerCase()
    if (byHash.has(hash)) fail(`transaction ${transaction.hash} is duplicated`)
    if (typeof transaction.label !== 'string' || !transaction.label.trim()) fail(`transaction ${transaction.hash} has no label`)
    if (!Array.isArray(transaction.observations)) fail(`transaction ${transaction.hash} observations are missing`)
    assertConvenienceFields(transaction)
    const expectedExplorer = transactionExplorer(transaction.hash)
    if (transaction.explorer) requireEqual(transaction.explorer, expectedExplorer, `${transaction.label} explorer`)
    byHash.set(hash, transaction)
  }
  return byHash
}

function requireSuccessfulTransaction(byHash, hash, label) {
  requirePattern(hash, TRANSACTION_PATTERN, `${label} transaction`)
  const transaction = byHash.get(hash.toLowerCase())
  if (!transaction) fail(`${label} transaction ${hash} is absent from the artifact`)
  if (!transaction.finalized || !successfulFinalization(transaction.finalized)) {
    fail(`${label} transaction ${hash} has no successful FINALIZED lifecycle observation`)
  }
  return transaction
}

function scenarioTransactionSummary(scenario, byHash, label) {
  const fields = [
    ['postTransaction', 'post'],
    ['submissionTransaction', 'submission'],
    ['evaluationTransaction', 'evaluation'],
  ]
  const result = {}
  for (const [field, publicName] of fields) {
    const hash = scenario?.[field]
    if (!hash) fail(`${label} ${field} is missing`)
    requireSuccessfulTransaction(byHash, hash, `${label} ${publicName}`)
    result[publicName] = { hash, explorer: transactionExplorer(hash) }
  }
  return result
}

function publicScenarioHistory(history, byHash) {
  if (!Array.isArray(history)) return []
  return history.map((entry, index) => {
    const publicEntry = {
      title: entry.title,
      bountyId: entry.bountyId,
      submissionId: entry.submissionId,
      status: entry.status,
      replacementReason: entry.replacementReason ?? null,
      submissionDeadline: entry.submissionDeadline ?? null,
      evaluationDeadline: entry.evaluationDeadline ?? null,
      transactions: {},
    }
    for (const [field, publicName] of [
      ['postTransaction', 'post'],
      ['submissionTransaction', 'submission'],
      ['evaluationTransaction', 'evaluation'],
      ['closureTransaction', 'closure'],
    ]) {
      const hash = entry[field]
      if (!hash) continue
      const transaction = byHash.get(hash.toLowerCase())
      if (!transaction) fail(`mutation history ${index} ${field} is absent from transaction history`)
      if (field !== 'submissionTransaction' || transaction.finalized) {
        requireSuccessfulTransaction(byHash, hash, `mutation history ${index} ${publicName}`)
      }
      publicEntry.transactions[publicName] = { hash, explorer: transactionExplorer(hash) }
    }
    return publicEntry
  })
}

function validateRepositoryProvenance(proof, repositoryRoot = REPOSITORY_ROOT) {
  const contractPath = resolve(repositoryRoot, 'contracts/content_bounty.py')
  const currentSource = readFileSync(contractPath)
  const currentSha256 = createHash('sha256').update(currentSource).digest('hex')
  requireEqual(currentSha256, DEPLOYED_SOURCE_SHA256, 'current contract source SHA-256')

  for (const commit of [proof.deployedSource.commit, proof.runner.commit]) {
    const result = spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: repositoryRoot,
      encoding: null,
    })
    if (result.status !== 0) {
      fail(`recorded commit ${commit} is not available in this repository`)
    }
  }
  const sourceResult = spawnSync(
    'git',
    ['show', `${proof.deployedSource.commit}:contracts/content_bounty.py`],
    { cwd: repositoryRoot, encoding: null },
  )
  if (sourceResult.status !== 0 || !sourceResult.stdout) {
    fail('deployed contract source cannot be read from its recorded commit')
  }
  const deployedSha256 = createHash('sha256').update(sourceResult.stdout).digest('hex')
  requireEqual(deployedSha256, DEPLOYED_SOURCE_SHA256, 'deployed commit contract source SHA-256')
}

export function validateCompletedLiveProof(proof, {
  rawMode,
  verifyRepository = false,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) fail('artifact is not a JSON object')
  if (rawMode !== undefined && (rawMode & 0o777) !== 0o600) fail('raw artifact mode must be 0600')
  requireEqual(proof.status, 'COMPLETE', 'artifact status')
  requireEqual(proof.proofComplete, true, 'proofComplete')
  requireEqual(proof.persistentPayoutProofValid, true, 'persistentPayoutProofValid')
  requireEqual(proof.persistentPayoutProofEligible, true, 'persistentPayoutProofEligible')
  requireEqual(proof.persistent, true, 'persistent flag')
  requireEqual(proof.balancesSimulated, false, 'balancesSimulated')
  requireEqual(proof.network, 'testnetBradbury', 'network')
  requireEqual(proof.proofMode, 'persistent', 'proof mode')
  requireEqual(proof.chainId, 4221, 'chain ID')
  for (const check of REQUIRED_COMPLETION_CHECKS) requireEqual(proof.completionChecks?.[check], true, `completionChecks.${check}`)

  requireCaseInsensitive(proof.contractAddress, AUTHORITATIVE_CONTRACT_ADDRESS, 'contract address')
  requireCaseInsensitive(proof.scenarios?.deployment?.address, AUTHORITATIVE_CONTRACT_ADDRESS, 'deployment scenario contract address')
  requireCaseInsensitive(proof.scenarios?.deployment?.hash, AUTHORITATIVE_DEPLOYMENT_TRANSACTION, 'deployment transaction')
  requireEqual(proof.scenarios?.deployment?.finalized, true, 'deployment finalized flag')
  requireEqual(proof.scenarios?.deployment?.sourceSha256, DEPLOYED_SOURCE_SHA256, 'deployment source SHA-256')

  requireEqual(proof.sourceCommit, DEPLOYED_SOURCE_COMMIT, 'legacy source commit')
  requireEqual(proof.sourceSha256, DEPLOYED_SOURCE_SHA256, 'legacy source SHA-256')
  requireEqual(proof.deployedSource?.commit, DEPLOYED_SOURCE_COMMIT, 'deployed source commit')
  requireEqual(proof.deployedSource?.sha256, DEPLOYED_SOURCE_SHA256, 'deployed source SHA-256')
  requirePattern(proof.runner?.commit, COMMIT_PATTERN, 'runner commit')
  requireEqual(proof.runner?.dirty, false, 'runner dirty state')
  requirePattern(proof.deployer, ADDRESS_PATTERN, 'deployer address')
  requirePattern(proof.creator, ADDRESS_PATTERN, 'creator address')
  if (proof.deployer.toLowerCase() === proof.creator.toLowerCase()) fail('deployer and creator must be distinct')
  requirePattern(proof.updatedAt, /^\d{4}-\d{2}-\d{2}T/, 'proof update timestamp')

  assertNoSecretBearingValues(proof)
  const byHash = validateTransactionCollection(proof)
  requireSuccessfulTransaction(byHash, AUTHORITATIVE_DEPLOYMENT_TRANSACTION, 'deployment')

  const rejectionScenario = proof.scenarios?.clearRejectionScenario
  const mutationScenario = proof.scenarios?.mutationScenario
  const approvalScenario = proof.scenarios?.approvalScenario
  if (!rejectionScenario || !mutationScenario || !approvalScenario) fail('one or more required scenario records are missing')
  scenarioTransactionSummary(rejectionScenario, byHash, 'clear rejection')
  scenarioTransactionSummary(mutationScenario, byHash, 'mutation')
  scenarioTransactionSummary(approvalScenario, byHash, 'clear approval')

  const fixture = loadCommittedLiveAdversarialFixture()
  const artifactFixture = proof.adversarialRejectionFixture
  requireEqual(artifactFixture?.fixtureVersion, fixture.fixtureVersion, 'adversarial fixture version')
  requireEqual(artifactFixture?.expectedNormalizedSha256, fixture.expectedNormalizedSha256, 'adversarial fixture expected SHA-256')
  requireEqual(artifactFixture?.observedOnChainSha256, fixture.expectedNormalizedSha256, 'adversarial fixture on-chain SHA-256')
  requireEqual(artifactFixture?.characterCount, fixture.characterCount, 'adversarial fixture character count')
  requireEqual(artifactFixture?.verified, true, 'adversarial fixture verification')

  const rejected = proof.scenarios?.clearRejection?.submission
  requireEqual(rejected?.status, 'REJECTED', 'clear rejection status')
  requireEqual(rejected?.decision, 'REJECT', 'clear rejection decision')
  requireEqual(rejected?.evidence_sha256, fixture.expectedNormalizedSha256, 'clear rejection evidence SHA-256')
  requireEqual(rejected?.id, rejectionScenario.submissionId, 'clear rejection submission ID')
  requireEqual(rejected?.bounty_id, rejectionScenario.bountyId, 'clear rejection bounty ID')
  requirePublicHttpsUrl(rejected?.evidence_uri, 'clear rejection evidence URI')

  requireEqual(proof.scenarios?.mutationState?.state, 'CONFIRMED', 'mutation checkpoint state')
  requireEqual(proof.scenarios?.mutationWebhook?.state, 'CONFIRMED', 'mutation webhook state')
  const inconclusive = proof.scenarios?.inconclusiveMutation
  requireEqual(inconclusive?.status, 'INCONCLUSIVE', 'mutation evaluation status')
  requireEqual(inconclusive?.decision, 'INCONCLUSIVE', 'mutation decision')
  if (!['DIGEST_MISMATCH', 'FETCH_FAILED'].includes(inconclusive?.reason_code)) {
    fail(`mutation reason must be DIGEST_MISMATCH or FETCH_FAILED, got ${inconclusive?.reason_code ?? 'MISSING'}`)
  }
  requireEqual(inconclusive?.id, mutationScenario.submissionId, 'mutation submission ID')
  requireEqual(inconclusive?.bounty_id, mutationScenario.bountyId, 'mutation bounty ID')
  requirePublicHttpsUrl(mutationScenario.evidenceUri, 'mutation evidence URI')

  const approved = proof.scenarios?.clearApproval
  requireEqual(approved?.status, 'APPROVED', 'clear approval status')
  requireEqual(approved?.decision, 'APPROVE', 'clear approval decision')
  requireEqual(approved?.reason_code, 'ALL_REQUIRED_CRITERIA_MET', 'clear approval reason')
  requireEqual(approved?.id, approvalScenario.submissionId, 'approval submission ID')
  requireEqual(approved?.bounty_id, approvalScenario.bountyId, 'approval bounty ID')
  requirePublicHttpsUrl(approvalScenario.evidenceUri, 'approval evidence URI')

  const payout = proof.scenarios?.finalizedPayout
  requireEqual(payout?.recipient, proof.creator, 'payout recipient')
  requireEqual(payout?.expectedReward, EXPECTED_PAYOUT_WEI, 'expected payout')
  requireEqual(payout?.balanceDelta, EXPECTED_PAYOUT_WEI, 'payout balance delta')
  requireEqual(payout?.deltaMatchesReward, true, 'payout delta match')
  requireEqual(payout?.balancesSimulated, false, 'payout balancesSimulated')
  requireEqual(payout?.persistentProofValid, true, 'payout persistent proof flag')
  if (BigInt(payout.balanceAfter) - BigInt(payout.balanceBefore) !== BigInt(EXPECTED_PAYOUT_WEI)) {
    fail('payout before/after balances do not produce the recorded exact delta')
  }

  if (verifyRepository) validateRepositoryProvenance(proof, repositoryRoot)
  return { byHash, fixture }
}

function transactionPublicRecord(transaction) {
  return {
    label: transaction.label,
    hash: transaction.hash,
    explorer: transactionExplorer(transaction.hash),
    status: transaction.status ?? null,
    recovered: Boolean(transaction.recovered),
    acceptedPhaseObserved: transaction.acceptedPhaseObserved,
    successfulFinalizationObserved: transaction.successfulFinalizationObserved,
    separateAcceptedAndFinalizedObservations: transaction.separateAcceptedAndFinalizedObservations,
    observations: transaction.observations.map(publicObservation),
  }
}

function publicResult(submission) {
  return {
    bountyId: submission.bounty_id,
    submissionId: submission.id,
    status: submission.status,
    decision: submission.decision,
    reasonCode: submission.reason_code,
    criteriaBits: submission.criteria_bits,
    scoreBucket: submission.score_bucket,
    evidenceSha256: submission.evidence_sha256,
    submittedAt: submission.submitted_at,
    evaluatedAt: submission.evaluated_at,
    rubricVersion: submission.rubric_version,
    evaluatorVersion: submission.evaluator_version,
  }
}

export function sanitizeCompletedLiveProof(proof, options = {}) {
  const { byHash, fixture } = validateCompletedLiveProof(proof, options)
  const rejectionScenario = proof.scenarios.clearRejectionScenario
  const mutationScenario = proof.scenarios.mutationScenario
  const approvalScenario = proof.scenarios.approvalScenario
  const payout = proof.scenarios.finalizedPayout
  const publicProof = {
    schemaVersion: PUBLIC_PROOF_SCHEMA_VERSION,
    proofCapturedAt: proof.updatedAt,
    status: proof.status,
    proofComplete: proof.proofComplete,
    persistentPayoutProofValid: proof.persistentPayoutProofValid,
    completionChecks: Object.fromEntries(REQUIRED_COMPLETION_CHECKS.map((check) => [check, proof.completionChecks[check]])),
    network: {
      selector: proof.network,
      proofMode: proof.proofMode,
      chainId: proof.chainId,
      persistent: proof.persistent,
      balancesSimulated: proof.balancesSimulated,
      valueSemantics: proof.valueSemantics,
      consensusContract: proof.consensusContract,
      explorer: BRADBURY_EXPLORER,
    },
    contract: {
      address: proof.contractAddress,
      explorer: contractExplorer(proof.contractAddress),
    },
    deployment: {
      transaction: AUTHORITATIVE_DEPLOYMENT_TRANSACTION,
      explorer: transactionExplorer(AUTHORITATIVE_DEPLOYMENT_TRANSACTION),
      lifecycle: {
        statusName: proof.recoveredDeployment?.lifecycle?.statusName ?? 'FINALIZED',
        resultName: proof.recoveredDeployment?.lifecycle?.resultName ?? 'AGREE',
        executionResultName: proof.recoveredDeployment?.lifecycle?.executionResultName ?? 'FINISHED_WITH_RETURN',
      },
    },
    provenance: {
      deployedSource: {
        commit: proof.deployedSource.commit,
        sha256: proof.deployedSource.sha256,
      },
      runner: {
        commit: proof.runner.commit,
        dirty: proof.runner.dirty,
      },
    },
    accounts: {
      deployer: proof.deployer,
      creatorAndPayoutRecipient: proof.creator,
    },
    adversarialRejectionFixture: {
      fixtureVersion: fixture.fixtureVersion,
      fixtureName: fixture.fixtureName,
      expectedNormalizedSha256: fixture.expectedNormalizedSha256,
      observedOnChainSha256: proof.adversarialRejectionFixture.observedOnChainSha256,
      characterCount: fixture.characterCount,
      utf8ByteCount: fixture.utf8ByteCount,
      verified: proof.adversarialRejectionFixture.verified,
      adversarialCases: fixture.adversarialCases,
    },
    scenarios: {
      clearRejection: {
        title: rejectionScenario.title,
        bountyId: rejectionScenario.bountyId,
        submissionId: rejectionScenario.submissionId,
        evidenceUri: proof.scenarios.clearRejection.submission.evidence_uri,
        transactions: scenarioTransactionSummary(rejectionScenario, byHash, 'clear rejection'),
        result: publicResult(proof.scenarios.clearRejection.submission),
      },
      mutationInconclusive: {
        title: mutationScenario.title,
        bountyId: mutationScenario.bountyId,
        submissionId: mutationScenario.submissionId,
        evidenceUri: mutationScenario.evidenceUri,
        submissionDeadline: mutationScenario.submissionDeadline,
        evaluationDeadline: mutationScenario.evaluationDeadline,
        transactions: scenarioTransactionSummary(mutationScenario, byHash, 'mutation'),
        mutationCheckpoint: {
          state: proof.scenarios.mutationState.state,
          pendingAt: proof.scenarios.mutationState.pendingAt,
          confirmedAt: proof.scenarios.mutationState.confirmedAt,
          webhookCalledExactlyOnceByRunner: proof.scenarios.mutationState.state === 'CONFIRMED',
        },
        result: publicResult(proof.scenarios.inconclusiveMutation),
        replacementHistory: publicScenarioHistory(mutationScenario.history, byHash),
      },
      clearApprovalAndPayout: {
        title: approvalScenario.title,
        bountyId: approvalScenario.bountyId,
        submissionId: approvalScenario.submissionId,
        evidenceUri: approvalScenario.evidenceUri,
        submissionDeadline: approvalScenario.submissionDeadline,
        evaluationDeadline: approvalScenario.evaluationDeadline,
        transactions: scenarioTransactionSummary(approvalScenario, byHash, 'clear approval'),
        result: publicResult(proof.scenarios.clearApproval),
        payout: {
          recipient: payout.recipient,
          balanceBefore: payout.balanceBefore,
          balanceAfter: payout.balanceAfter,
          balanceDelta: payout.balanceDelta,
          expectedReward: payout.expectedReward,
          deltaMatchesReward: payout.deltaMatchesReward,
          balancesSimulated: payout.balancesSimulated,
          persistentProofValid: payout.persistentProofValid,
        },
      },
    },
    transactions: proof.transactions.map(transactionPublicRecord),
    limitations: {
      fabricatedLeaderDisagreement: proof.unsupported?.fabricatedLeaderDisagreement ?? null,
    },
  }
  assertNoSecretBearingValues(publicProof)
  return publicProof
}

export function validatePublicLiveProof(publicProof, {
  verifyRepository = false,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  if (!publicProof || typeof publicProof !== 'object') fail('public proof is not a JSON object')
  requireEqual(publicProof.schemaVersion, PUBLIC_PROOF_SCHEMA_VERSION, 'public proof schema version')
  requireEqual(publicProof.status, 'COMPLETE', 'public proof status')
  requireEqual(publicProof.proofComplete, true, 'public proofComplete')
  requireEqual(publicProof.persistentPayoutProofValid, true, 'public persistent payout proof')
  for (const check of REQUIRED_COMPLETION_CHECKS) requireEqual(publicProof.completionChecks?.[check], true, `public completionChecks.${check}`)
  requireEqual(publicProof.network?.selector, 'testnetBradbury', 'public network')
  requireEqual(publicProof.network?.proofMode, 'persistent', 'public proof mode')
  requireEqual(publicProof.network?.persistent, true, 'public persistent flag')
  requireEqual(publicProof.network?.balancesSimulated, false, 'public simulated balance flag')
  requireCaseInsensitive(publicProof.contract?.address, AUTHORITATIVE_CONTRACT_ADDRESS, 'public contract address')
  requireCaseInsensitive(publicProof.deployment?.transaction, AUTHORITATIVE_DEPLOYMENT_TRANSACTION, 'public deployment transaction')
  requireEqual(publicProof.provenance?.deployedSource?.commit, DEPLOYED_SOURCE_COMMIT, 'public deployed source commit')
  requireEqual(publicProof.provenance?.deployedSource?.sha256, DEPLOYED_SOURCE_SHA256, 'public deployed source SHA-256')
  requirePattern(publicProof.provenance?.runner?.commit, COMMIT_PATTERN, 'public runner commit')
  requireEqual(publicProof.provenance?.runner?.dirty, false, 'public runner dirty state')
  requireEqual(publicProof.adversarialRejectionFixture?.expectedNormalizedSha256, loadCommittedLiveAdversarialFixture().expectedNormalizedSha256, 'public adversarial fixture SHA-256')
  requireEqual(publicProof.adversarialRejectionFixture?.verified, true, 'public adversarial fixture verification')
  requireEqual(publicProof.scenarios?.clearRejection?.result?.status, 'REJECTED', 'public rejection result')
  requirePublicHttpsUrl(publicProof.scenarios?.clearRejection?.evidenceUri, 'public rejection evidence URI')
  requireEqual(publicProof.scenarios?.mutationInconclusive?.result?.status, 'INCONCLUSIVE', 'public mutation result')
  if (!['DIGEST_MISMATCH', 'FETCH_FAILED'].includes(publicProof.scenarios?.mutationInconclusive?.result?.reasonCode)) {
    fail('public mutation reason is not an allowed inconclusive result')
  }
  requireEqual(publicProof.scenarios?.mutationInconclusive?.mutationCheckpoint?.state, 'CONFIRMED', 'public mutation checkpoint')
  requirePublicHttpsUrl(publicProof.scenarios?.mutationInconclusive?.evidenceUri, 'public mutation evidence URI')
  requireEqual(publicProof.scenarios?.clearApprovalAndPayout?.result?.status, 'APPROVED', 'public approval result')
  requirePublicHttpsUrl(publicProof.scenarios?.clearApprovalAndPayout?.evidenceUri, 'public approval evidence URI')
  const payout = publicProof.scenarios?.clearApprovalAndPayout?.payout
  requireEqual(payout?.balanceDelta, EXPECTED_PAYOUT_WEI, 'public payout delta')
  requireEqual(payout?.expectedReward, EXPECTED_PAYOUT_WEI, 'public payout reward')
  requireEqual(payout?.persistentProofValid, true, 'public payout proof flag')
  if (BigInt(payout.balanceAfter) - BigInt(payout.balanceBefore) !== BigInt(EXPECTED_PAYOUT_WEI)) {
    fail('public payout balances do not produce the expected delta')
  }
  if (!Array.isArray(publicProof.transactions) || !publicProof.transactions.length) fail('public transaction evidence is missing')
  for (const transaction of publicProof.transactions) {
    requirePattern(transaction.hash, TRANSACTION_PATTERN, 'public transaction hash')
    requireEqual(transaction.explorer, transactionExplorer(transaction.hash), `${transaction.label} public explorer`)
  }
  assertNoSecretBearingValues(publicProof)
  if (verifyRepository) {
    validateRepositoryProvenance({
      deployedSource: publicProof.provenance.deployedSource,
      runner: publicProof.provenance.runner,
    }, repositoryRoot)
  }
  return publicProof
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function atomicWritePublicProof(output, content) {
  const target = resolve(output)
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o644 })
  chmodSync(temporary, 0o644)
  renameSync(temporary, target)
  chmodSync(target, 0o644)
  return target
}

export function exportLiveProof({
  input = DEFAULT_RAW_PROOF,
  output = DEFAULT_PUBLIC_PROOF,
  check = false,
  verifyRepository = true,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const inputPath = resolve(input)
  const proof = JSON.parse(readFileSync(inputPath, 'utf8'))
  const publicProof = sanitizeCompletedLiveProof(proof, {
    rawMode: statSync(inputPath).mode,
    verifyRepository,
    repositoryRoot,
  })
  validatePublicLiveProof(publicProof, { verifyRepository, repositoryRoot })
  const content = json(publicProof)
  const outputPath = resolve(output)
  if (check) {
    const existing = readFileSync(outputPath, 'utf8')
    if (existing !== content) fail(`public proof is stale; regenerate ${outputPath}`)
  } else {
    atomicWritePublicProof(outputPath, content)
  }
  return { input: inputPath, output: outputPath, proof: publicProof }
}

function parseArguments(argv) {
  const options = { input: DEFAULT_RAW_PROOF, output: DEFAULT_PUBLIC_PROOF, check: false, publicOnly: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--input') options.input = argv[++index]
    else if (argument === '--output') options.output = argv[++index]
    else if (argument === '--check') options.check = true
    else if (argument === '--public-only') options.publicOnly = argv[++index]
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!options.input || !options.output) throw new Error('--input and --output require paths')
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.publicOnly) {
      const path = resolve(options.publicOnly)
      validatePublicLiveProof(JSON.parse(readFileSync(path, 'utf8')), { verifyRepository: true })
      console.log(`Validated sanitized live proof: ${path}`)
    } else {
      const result = exportLiveProof(options)
      console.log(`${options.check ? 'Validated' : 'Exported'} completed live proof: ${result.output}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
