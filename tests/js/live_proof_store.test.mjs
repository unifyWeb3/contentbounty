import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkpointProof,
  createProofArtifact,
  loadProofArtifact,
  recordProofFailure,
  recordProofExternalBlocker,
  recordTransactionObservation,
  resumeProofArtifact,
  updateProofCompletion,
} from '../../scripts/live-proof-store.mjs'

function temporaryOutput() {
  return join(mkdtempSync(join(tmpdir(), 'contentbounty-proof-')), 'proof.json')
}

test('creates a mode-0600 artifact and preserves lifecycle observations on failure', () => {
  const output = temporaryOutput()
  const proof = createProofArtifact(output, {
    persistent: true,
    persistentPayoutProofEligible: true,
    transactions: [{
      hash: '0xabc',
      observations: [
        { phase: 'ACCEPTED', observedAt: '2026-08-07T00:00:01Z' },
        { phase: 'FINALIZED', observedAt: '2026-08-07T00:00:02Z' },
      ],
    }, {
      hash: '0xdef',
      observations: [
        { phase: 'FAILED', failureReason: 'Validators timed out', observedAt: '2026-08-07T00:00:03Z' },
      ],
    }],
  })
  checkpointProof(output, proof)
  recordProofFailure(output, proof, new Error('finalized execution failed for 0x' + 'a'.repeat(64)))
  const stored = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(stored.status, 'FAILED')
  assert.equal(stored.proofComplete, false)
  assert.equal(stored.failure.message, 'finalized execution failed for <redacted-secret>')
  assert.deepEqual(stored.transactions[0].observations.map((item) => item.phase), ['ACCEPTED', 'FINALIZED'])
  assert.deepEqual(stored.transactions[1].observations.map((item) => item.phase), ['FAILED'])
  assert.equal(statSync(output).mode & 0o777, 0o600)
})

test('tightens permissions when replacing an existing broad-mode artifact', () => {
  const output = temporaryOutput()
  writeFileSync(output, '{"old":true}\n', { mode: 0o644 })
  chmodSync(output, 0o644)
  const proof = createProofArtifact(output, {
    persistent: false,
    balancesSimulated: true,
    persistentPayoutProofEligible: false,
  })
  checkpointProof(output, proof)
  assert.equal(statSync(output).mode & 0o777, 0o600)
})

test('loads an existing proof artifact for recovery without changing it', () => {
  const output = temporaryOutput()
  const proof = createProofArtifact(output, { persistent: true, transactions: [{ hash: '0xabc' }] })
  const loaded = loadProofArtifact(output)
  assert.equal(loaded.status, 'RUNNING')
  assert.equal(loaded.transactions[0].hash, '0xabc')
})

test('normalizes legacy inconsistent transaction convenience fields on load and resume', () => {
  const output = temporaryOutput()
  writeFileSync(output, JSON.stringify({
    status: 'BLOCKED_EXTERNAL_RPC',
    proofComplete: false,
    transactions: [{
      hash: '0xlegacy',
      observations: [
        { phase: 'ACCEPTED', observedAt: '2026-08-09T00:00:01Z' },
        { phase: 'FINALIZED', observedAt: '2026-08-09T00:00:02Z' },
      ],
      acceptedPhaseObserved: false,
      successfulFinalizationObserved: false,
      separateAcceptedAndFinalizedObservations: false,
      accepted: null,
      finalized: null,
    }],
  }))
  const loaded = loadProofArtifact(output)
  assert.equal(loaded.transactions[0].acceptedPhaseObserved, true)
  assert.equal(loaded.transactions[0].successfulFinalizationObserved, true)
  assert.equal(loaded.transactions[0].separateAcceptedAndFinalizedObservations, true)
  assert.equal(loaded.transactions[0].accepted.phase, 'ACCEPTED')
  assert.equal(loaded.transactions[0].finalized.phase, 'FINALIZED')
  resumeProofArtifact(loaded)
  checkpointProof(output, loaded)
  const stored = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(stored.status, 'RUNNING')
  assert.equal(stored.transactions[0].successfulFinalizationObserved, true)
})

test('proofComplete requires every persistent settlement check', () => {
  const proof = {
    persistent: true,
    persistentPayoutProofEligible: true,
    completionChecks: {
      deploymentFinalized: true,
      clearRejection: true,
      adversarialRejectionVerified: false,
      mutationInconclusive: true,
      clearApprovalFinalized: true,
      persistentPayoutDelta: false,
    },
  }
  assert.equal(updateProofCompletion(proof), false)
  proof.completionChecks.adversarialRejectionVerified = true
  assert.equal(updateProofCompletion(proof), false)
  proof.completionChecks.persistentPayoutDelta = true
  assert.equal(updateProofCompletion(proof), true)
  proof.persistent = false
  assert.equal(updateProofCompletion(proof), false)
})

test('external RPC blockers checkpoint ordered failure state and resume safely', () => {
  const output = temporaryOutput()
  const proof = createProofArtifact(output, { persistent: true, persistentPayoutProofEligible: true })
  recordProofExternalBlocker(output, proof, new Error('Bradbury fetch failed'), () => '2026-08-09T00:00:01Z')
  const blocked = loadProofArtifact(output)
  assert.equal(blocked.status, 'BLOCKED_EXTERNAL_RPC')
  assert.equal(blocked.updatedAt >= blocked.failure.timestamp, true)
  resumeProofArtifact(blocked, () => '2026-08-09T00:00:02Z')
  checkpointProof(output, blocked, () => '2026-08-09T00:00:03Z')
  const resumed = loadProofArtifact(output)
  assert.equal(resumed.status, 'RUNNING')
  assert.equal(resumed.failure, null)
})

test('convenience lifecycle fields are updated before checkpoint', () => {
  const transaction = { observations: [], acceptedPhaseObserved: false, successfulFinalizationObserved: false }
  recordTransactionObservation(transaction, { phase: 'ACCEPTED', observedAt: '2026-08-09T00:00:01Z' })
  assert.equal(transaction.acceptedPhaseObserved, true)
  assert.equal(transaction.accepted.phase, 'ACCEPTED')
  recordTransactionObservation(transaction, { phase: 'FINALIZED', observedAt: '2026-08-09T00:00:02Z' })
  assert.equal(transaction.successfulFinalizationObserved, true)
  assert.equal(transaction.separateAcceptedAndFinalizedObservations, true)
})

test('redacts private keys and authenticated URL queries from persisted failures', () => {
  const output = temporaryOutput()
  const proof = createProofArtifact(output, { persistent: true })
  recordProofFailure(
    output,
    proof,
    new Error(`failed 0x${'a'.repeat(64)} at https://evidence.example/mutate?auth=fake-credential`),
  )
  const stored = loadProofArtifact(output)
  assert.equal(stored.failure.message.includes('fake-credential'), false)
  assert.equal(stored.failure.message.includes(`0x${'a'.repeat(64)}`), false)
  assert.match(stored.failure.message, /<redacted-secret>/)
  assert.match(stored.failure.message, /<redacted-query>/)
})
