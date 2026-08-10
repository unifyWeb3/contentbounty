import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AUTHORITATIVE_CONTRACT_ADDRESS,
  AUTHORITATIVE_DEPLOYMENT_TRANSACTION,
  DEPLOYED_SOURCE_COMMIT,
  DEPLOYED_SOURCE_SHA256,
  EXPECTED_PAYOUT_WEI,
  exportLiveProof,
  PUBLIC_PROOF_SCHEMA_VERSION,
  sanitizeCompletedLiveProof,
  validatePublicLiveProof,
} from '../../scripts/export_live_proof.mjs'
import { verifyPublicProofOnline } from '../../scripts/verify_live_proof_online.mjs'

const rejectionHash = 'efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537'
const runnerCommit = '936864e822c754eaf2bf13432ef38e6a2a7c3d3c'

function observation(phase, observedAt) {
  return {
    observedAt,
    requestedStatus: phase,
    phase,
    terminal: phase === 'FINALIZED',
    statusName: phase,
    resultName: 'AGREE',
    executionResultName: 'FINISHED_WITH_RETURN',
  }
}

function transaction(label, hash) {
  const accepted = observation('ACCEPTED', '2026-08-10T00:00:00Z')
  const finalized = observation('FINALIZED', '2026-08-10T00:01:00Z')
  return {
    label,
    hash,
    explorer: `https://explorer-bradbury.genlayer.com/tx/${hash}`,
    observations: [accepted, finalized],
    accepted,
    finalized,
    acceptedPhaseObserved: true,
    successfulFinalizationObserved: true,
    separateAcceptedAndFinalizedObservations: true,
  }
}

const hashes = {
  rejectionPost: `0x${'1'.repeat(64)}`,
  rejectionSubmit: `0x${'2'.repeat(64)}`,
  rejectionEvaluate: `0x${'3'.repeat(64)}`,
  mutationPost: `0x${'4'.repeat(64)}`,
  mutationSubmit: `0x${'5'.repeat(64)}`,
  mutationEvaluate: `0x${'6'.repeat(64)}`,
  approvalPost: `0x${'7'.repeat(64)}`,
  approvalSubmit: `0x${'8'.repeat(64)}`,
  approvalEvaluate: `0x${'9'.repeat(64)}`,
}

function completedProof() {
  const deployment = transaction('recover v2.1.1 deployment', AUTHORITATIVE_DEPLOYMENT_TRANSACTION)
  const transactions = [
    deployment,
    transaction('post rejection', hashes.rejectionPost),
    transaction('submit rejection', hashes.rejectionSubmit),
    transaction('evaluate rejection', hashes.rejectionEvaluate),
    transaction('post mutation', hashes.mutationPost),
    transaction('submit mutation', hashes.mutationSubmit),
    transaction('evaluate mutation', hashes.mutationEvaluate),
    transaction('post approval', hashes.approvalPost),
    transaction('submit approval', hashes.approvalSubmit),
    transaction('evaluate approval', hashes.approvalEvaluate),
  ]
  const scenario = (scenarioKey, title, bountyId, submissionId, postTransaction, submissionTransaction, evaluationTransaction) => ({
    scenarioKey,
    title,
    bountyId,
    submissionId,
    postTransaction,
    submissionTransaction,
    evaluationTransaction,
    evidenceUri: `https://evidence.example/${scenarioKey}.txt`,
    history: [],
    submissionDeadline: 2000000000,
    evaluationDeadline: 2000014400,
  })
  return {
    status: 'COMPLETE',
    proofComplete: true,
    persistentPayoutProofValid: true,
    persistentPayoutProofEligible: true,
    persistent: true,
    balancesSimulated: false,
    network: 'testnetBradbury',
    proofMode: 'persistent',
    chainId: 4221,
    valueSemantics: 'PERSISTENT_PUBLIC_TESTNET_VALUES',
    consensusContract: '0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D',
    completionChecks: {
      deploymentFinalized: true,
      clearRejection: true,
      adversarialRejectionVerified: true,
      mutationInconclusive: true,
      clearApprovalFinalized: true,
      persistentPayoutDelta: true,
    },
    contractAddress: AUTHORITATIVE_CONTRACT_ADDRESS,
    sourceCommit: DEPLOYED_SOURCE_COMMIT,
    sourceSha256: DEPLOYED_SOURCE_SHA256,
    deployedSource: { commit: DEPLOYED_SOURCE_COMMIT, sha256: DEPLOYED_SOURCE_SHA256 },
    runner: { commit: runnerCommit, dirty: false },
    deployer: '0x381b78F0C90a29cE2acDB718a9A4E1387004D3c7',
    creator: '0x7fD87C28F4345ee8A4124511e16084464ca2E123',
    updatedAt: '2026-08-10T13:00:31.144Z',
    transactions,
    adversarialRejectionFixture: {
      fixtureVersion: 'content-bounty-live-adversarial-rejection-v1',
      expectedNormalizedSha256: rejectionHash,
      observedOnChainSha256: rejectionHash,
      characterCount: 1092,
      verified: true,
    },
    scenarios: {
      deployment: {
        address: AUTHORITATIVE_CONTRACT_ADDRESS,
        hash: AUTHORITATIVE_DEPLOYMENT_TRANSACTION,
        finalized: true,
        sourceSha256: DEPLOYED_SOURCE_SHA256,
      },
      clearRejectionScenario: scenario(
        'clear-rejection', 'Live clear rejection', 0, 0,
        hashes.rejectionPost, hashes.rejectionSubmit, hashes.rejectionEvaluate,
      ),
      mutationScenario: scenario(
        'mutation', 'Live mutation inconclusive [fixture]', 4, 2,
        hashes.mutationPost, hashes.mutationSubmit, hashes.mutationEvaluate,
      ),
      approvalScenario: scenario(
        'clear-approval', 'Live clear approval and payout [fixture]', 5, 3,
        hashes.approvalPost, hashes.approvalSubmit, hashes.approvalEvaluate,
      ),
      clearRejection: {
        submission: {
          bounty_id: 0, id: 0, status: 'REJECTED', decision: 'REJECT', reason_code: 'CRITERIA_NOT_MET',
          criteria_bits: '00', score_bucket: 0, evidence_sha256: rejectionHash,
          evidence_uri: 'https://evidence.example/reject.txt',
          submitted_at: 1, evaluated_at: 2, rubric_version: 'rubric', evaluator_version: 'evaluator',
        },
      },
      mutationState: {
        state: 'CONFIRMED', mutableEvidenceUri: 'https://evidence.example/mutable.txt',
        pendingAt: '2026-08-10T00:02:00Z', confirmedAt: '2026-08-10T00:02:01Z',
      },
      mutationWebhook: { state: 'CONFIRMED' },
      inconclusiveMutation: {
        bounty_id: 4, id: 2, status: 'INCONCLUSIVE', decision: 'INCONCLUSIVE', reason_code: 'DIGEST_MISMATCH',
        criteria_bits: '', score_bucket: 0, evidence_sha256: 'a'.repeat(64),
        submitted_at: 3, evaluated_at: 4, rubric_version: 'rubric', evaluator_version: 'evaluator',
      },
      clearApproval: {
        bounty_id: 5, id: 3, status: 'APPROVED', decision: 'APPROVE', reason_code: 'ALL_REQUIRED_CRITERIA_MET',
        criteria_bits: '11', score_bucket: 4, evidence_sha256: 'b'.repeat(64),
        submitted_at: 5, evaluated_at: 6, rubric_version: 'rubric', evaluator_version: 'evaluator',
      },
      finalizedPayout: {
        recipient: '0x7fD87C28F4345ee8A4124511e16084464ca2E123',
        balanceBefore: '1000000000000000000',
        balanceAfter: '1001000000000000000',
        balanceDelta: EXPECTED_PAYOUT_WEI,
        expectedReward: EXPECTED_PAYOUT_WEI,
        deltaMatchesReward: true,
        balancesSimulated: false,
        persistentProofValid: true,
      },
    },
    unsupported: { fabricatedLeaderDisagreement: 'No supported public harness.' },
  }
}

test('builds and validates a deterministic sanitized public proof', () => {
  const publicProof = sanitizeCompletedLiveProof(completedProof())
  assert.equal(publicProof.schemaVersion, PUBLIC_PROOF_SCHEMA_VERSION)
  assert.equal(publicProof.contract.address, AUTHORITATIVE_CONTRACT_ADDRESS)
  assert.equal(publicProof.provenance.runner.commit, runnerCommit)
  assert.equal(publicProof.scenarios.mutationInconclusive.result.reasonCode, 'DIGEST_MISMATCH')
  assert.equal(publicProof.scenarios.clearApprovalAndPayout.payout.balanceDelta, EXPECTED_PAYOUT_WEI)
  assert.equal(JSON.stringify(publicProof).includes('mutableEvidenceUri'), false)
  assert.equal(validatePublicLiveProof(publicProof), publicProof)
})

test('rejects incomplete gates and inconsistent lifecycle convenience fields', () => {
  const incomplete = completedProof()
  incomplete.completionChecks.mutationInconclusive = false
  assert.throws(() => sanitizeCompletedLiveProof(incomplete), /completionChecks\.mutationInconclusive/)

  const inconsistent = completedProof()
  inconsistent.transactions[0].acceptedPhaseObserved = false
  assert.throws(() => sanitizeCompletedLiveProof(inconsistent), /acceptedPhaseObserved/)
})

test('rejects authenticated URLs and secret-bearing fields', () => {
  const authenticated = completedProof()
  authenticated.rpc = 'https://rpc.example/path?token=credential'
  assert.throws(() => sanitizeCompletedLiveProof(authenticated), /query-bearing URL/)

  const secretField = completedProof()
  secretField.mutationToken = 'must-not-appear'
  assert.throws(() => sanitizeCompletedLiveProof(secretField), /secret-bearing field/)
})

test('exports mode-0644 public JSON and detects stale tracked output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-public-proof-'))
  const input = join(directory, 'raw.json')
  const output = join(directory, 'public.json')
  writeFileSync(input, `${JSON.stringify(completedProof())}\n`, { mode: 0o600 })
  chmodSync(input, 0o600)

  const result = exportLiveProof({ input, output, verifyRepository: false })
  assert.equal(result.proof.proofComplete, true)
  assert.equal(statSync(output).mode & 0o777, 0o644)
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).status, 'COMPLETE')
  assert.doesNotThrow(() => exportLiveProof({ input, output, check: true, verifyRepository: false }))

  writeFileSync(output, '{}\n')
  assert.throws(
    () => exportLiveProof({ input, output, check: true, verifyRepository: false }),
    /public proof is stale/,
  )
})

test('independently verifies completion transactions and exact on-chain scenario records', async () => {
  const publicProof = sanitizeCompletedLiveProof(completedProof())
  const scenarios = [
    publicProof.scenarios.clearRejection,
    publicProof.scenarios.mutationInconclusive,
    publicProof.scenarios.clearApprovalAndPayout,
  ]
  const submissions = new Map(scenarios.map((scenario) => [String(scenario.submissionId), {
    id: scenario.submissionId,
    bounty_id: scenario.bountyId,
    creator: publicProof.accounts.creatorAndPayoutRecipient,
    status: scenario.result.status,
    decision: scenario.result.decision,
    reason_code: scenario.result.reasonCode,
    evidence_sha256: scenario.result.evidenceSha256,
    evidence_uri: scenario.evidenceUri,
  }]))
  const bounties = new Map(scenarios.map((scenario) => [String(scenario.bountyId), {
    id: scenario.bountyId,
    title: scenario.title,
    poster: publicProof.accounts.deployer,
    reward: EXPECTED_PAYOUT_WEI,
  }]))
  const client = {
    async getTransaction() {
      return {
        statusName: 'FINALIZED',
        resultName: 'AGREE',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
      }
    },
    async readContract({ functionName, args }) {
      return functionName === 'get_submission'
        ? submissions.get(String(args[0]))
        : bounties.get(String(args[0]))
    },
  }
  const result = await verifyPublicProofOnline({ proof: publicProof, client, retryOptions: { retries: 0 } })
  assert.equal(result.lifecycle.length, 10)
  assert.deepEqual(result.submissions.map((item) => item.status), ['REJECTED', 'INCONCLUSIVE', 'APPROVED'])
})
