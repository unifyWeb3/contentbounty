import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginMutation,
  confirmMutation,
  MUTATION_STATES,
  mutationMayPost,
  reconcileMutationState,
} from '../../scripts/live-mutation-state.mjs'

const uri = 'https://evidence.example/mutable.txt'

test('allows initial mutation and records a durable pending checkpoint', () => {
  const pending = beginMutation(null, uri, () => '2026-08-09T00:00:00Z')
  assert.deepEqual(pending, { state: MUTATION_STATES.PENDING, mutableEvidenceUri: uri, pendingAt: '2026-08-09T00:00:00Z' })
  assert.equal(mutationMayPost(null, 'initial', uri), true)
})

test('reconciles crash after POST before confirmation without reposting', () => {
  const pending = beginMutation(null, uri, () => '2026-08-09T00:00:00Z')
  const reconciled = reconcileMutationState(pending, 'mutated', uri)
  assert.equal(reconciled.state, MUTATION_STATES.CONFIRMED)
  assert.equal(reconciled.reconciled, true)
  assert.equal(mutationMayPost(reconciled, 'mutated', uri), false)
})

test('confirm requires a matching pending URI and initial plus confirmed fails closed', () => {
  const pending = beginMutation(null, uri)
  assert.equal(confirmMutation(pending, uri).state, MUTATION_STATES.CONFIRMED)
  assert.throws(() => confirmMutation(pending, 'https://other.example/mutable.txt'), /matching PENDING/)
  assert.throws(() => reconcileMutationState({ state: MUTATION_STATES.CONFIRMED, mutableEvidenceUri: uri }, 'initial', uri), /still reports initial/)
})

test('rejects every illegitimate worker/checkpoint combination', () => {
  assert.throws(() => reconcileMutationState(null, 'mutated', uri), /without a legitimate/)
  assert.throws(() => reconcileMutationState({ state: MUTATION_STATES.PENDING, mutableEvidenceUri: uri }, 'initial', 'https://other.example/x'), /URI/)
  assert.throws(() => reconcileMutationState({ state: MUTATION_STATES.NOT_STARTED }, 'unknown', uri), /unknown/)
})

test('covers the full checkpoint and Worker-state reconciliation matrix', () => {
  const cases = [
    [null, 'initial', MUTATION_STATES.NOT_STARTED, false],
    [{ state: MUTATION_STATES.PENDING, mutableEvidenceUri: uri }, 'initial', MUTATION_STATES.PENDING, false],
    [{ state: MUTATION_STATES.PENDING, mutableEvidenceUri: uri }, 'mutated', MUTATION_STATES.CONFIRMED, true],
    [{ state: MUTATION_STATES.CONFIRMED, mutableEvidenceUri: uri }, 'mutated', MUTATION_STATES.CONFIRMED, false],
    [{ state: MUTATION_STATES.CONFIRMED, mutableEvidenceUri: uri }, 'changed', MUTATION_STATES.CONFIRMED, false],
  ]
  for (const [checkpoint, workerState, expectedState, reconciled] of cases) {
    const result = reconcileMutationState(checkpoint, workerState, uri)
    assert.equal(result.state, expectedState)
    assert.equal(result.reconciled, reconciled)
  }
})
