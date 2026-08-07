import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkpointProof,
  createProofArtifact,
  recordProofFailure,
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

test('proofComplete requires every persistent settlement check', () => {
  const proof = {
    persistent: true,
    persistentPayoutProofEligible: true,
    completionChecks: {
      deploymentFinalized: true,
      clearRejection: true,
      mutationInconclusive: true,
      clearApprovalFinalized: true,
      persistentPayoutDelta: false,
    },
  }
  assert.equal(updateProofCompletion(proof), false)
  proof.completionChecks.persistentPayoutDelta = true
  assert.equal(updateProofCompletion(proof), true)
  proof.persistent = false
  assert.equal(updateProofCompletion(proof), false)
})
