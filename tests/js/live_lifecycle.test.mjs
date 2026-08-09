import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ExecutionResult,
  TransactionResult,
  TransactionStatus,
} from 'genlayer-js/types'
import {
  classifyLiveReceipt,
  waitForLiveLifecycle,
} from '../../scripts/live-lifecycle.mjs'

const successful = {
  resultName: TransactionResult.MAJORITY_AGREE,
  txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
}

test('accepts Bradbury AGREE as the successful decided consensus result', () => {
  assert.equal(classifyLiveReceipt({ statusName: 'ACCEPTED', resultName: 'AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' }).phase, 'ACCEPTED')
  assert.equal(classifyLiveReceipt({ statusName: 'FINALIZED', resultName: 'AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' }).phase, 'FINALIZED')
})

test('classifies numeric, camelCase, and snake_case receipt fields', () => {
  assert.equal(classifyLiveReceipt({ status: 5, result: 6, txExecutionResult: 1 }).phase, 'ACCEPTED')
  assert.equal(classifyLiveReceipt({ statusName: 'finalized', resultName: 'majority_agree', txExecutionResultName: 'finished_with_return' }).phase, 'FINALIZED')
  assert.equal(classifyLiveReceipt({ status_name: 'FINALIZED', result_name: 'MAJORITY_AGREE', tx_execution_result_name: 'FINISHED_WITH_RETURN' }).phase, 'FINALIZED')
})

test('accepts an already-finalized successful first observation without calling the waiter twice', async () => {
  const calls = []
  const observations = []
  const result = await waitForLiveLifecycle({
    client: {
      waitForTransactionReceipt: async (request) => {
        calls.push(request.status)
        return { statusName: TransactionStatus.FINALIZED, ...successful }
      },
    },
    hash: '0x1',
    now: (() => {
      let index = 0
      return () => `2026-08-07T00:00:0${index++}Z`
    })(),
    onObservation: (observation) => observations.push(observation),
  })
  assert.deepEqual(calls, [TransactionStatus.ACCEPTED])
  assert.equal(result.successfulFinalizationObserved, true)
  assert.equal(result.acceptedPhaseObserved, false)
  assert.equal(result.separateAcceptedAndFinalizedObservations, false)
  assert.equal(result.observations.length, 1)
  assert.equal(observations[0].observedAt, '2026-08-07T00:00:00Z')
})

test('records separate accepted and finalized observations', async () => {
  const calls = []
  const sequence = [
    { status: 5, result: 6, txExecutionResult: 1 },
    { status_name: 'FINALIZED', result_name: 'MAJORITY_AGREE', tx_execution_result_name: 'FINISHED_WITH_RETURN' },
  ]
  const result = await waitForLiveLifecycle({
    client: {
      waitForTransactionReceipt: async (request) => {
        calls.push(request.status)
        return sequence.shift()
      },
    },
    hash: '0x2',
    now: () => '2026-08-07T00:00:00Z',
  })
  assert.deepEqual(calls, [TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED])
  assert.equal(result.acceptedPhaseObserved, true)
  assert.equal(result.successfulFinalizationObserved, true)
  assert.equal(result.separateAcceptedAndFinalizedObservations, true)
  assert.equal(result.observations.length, 2)
})

test('fails correctly for terminal status, consensus, and execution failures', async () => {
  const cases = [
    { statusName: TransactionStatus.UNDETERMINED, ...successful },
    { statusName: TransactionStatus.CANCELED, ...successful },
    { statusName: TransactionStatus.VALIDATORS_TIMEOUT, ...successful },
    { statusName: TransactionStatus.LEADER_TIMEOUT, ...successful },
    { statusName: TransactionStatus.ACCEPTED, resultName: TransactionResult.MAJORITY_DISAGREE, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN },
    { statusName: TransactionStatus.ACCEPTED, resultName: TransactionResult.NO_MAJORITY, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN },
    { statusName: TransactionStatus.FINALIZED, resultName: TransactionResult.MAJORITY_AGREE, txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR },
  ]
  for (const receipt of cases) {
    await assert.rejects(
      waitForLiveLifecycle({
        client: { waitForTransactionReceipt: async () => receipt },
        hash: '0xfailure',
      }),
      /observation failed/i,
    )
  }
})

test('does not treat an intermediate finalization observation as success', async () => {
  await assert.rejects(
    waitForLiveLifecycle({
      client: {
        waitForTransactionReceipt: async ({ status }) => status === TransactionStatus.ACCEPTED
          ? { statusName: TransactionStatus.PENDING }
          : { statusName: TransactionStatus.READY_TO_FINALIZE, ...successful },
      },
      hash: '0xprocessing',
    }),
    /did not verify success/i,
  )
})

test('retries transient Bradbury lifecycle read failures without losing successful observations', async () => {
  let calls = 0
  const transientErrors = []
  const result = await waitForLiveLifecycle({
    client: {
      waitForTransactionReceipt: async () => {
        calls += 1
        if (calls <= 2) throw new Error('An unknown RPC error occurred. Details: fetch failed')
        return { statusName: 'FINALIZED', resultName: 'AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' }
      },
    },
    hash: '0xtransient',
    transientRetries: 2,
    transientRetryInterval: 0,
    sleep: async () => {},
    onTransientError: (error) => transientErrors.push(error),
  })
  assert.equal(calls, 3)
  assert.equal(transientErrors.length, 2)
  assert.equal(result.successfulFinalizationObserved, true)
  assert.equal(result.observations.length, 1)
})

test('fails closed after bounded transient lifecycle retries', async () => {
  let calls = 0
  await assert.rejects(waitForLiveLifecycle({
    client: { waitForTransactionReceipt: async () => { calls += 1; throw new Error('fetch failed') } },
    hash: '0xoutage',
    transientRetries: 2,
    transientRetryInterval: 0,
    sleep: async () => {},
  }), /fetch failed/)
  assert.equal(calls, 3)
})

test('keeps accepted and finalized convenience fields aligned at each observation', async () => {
  const transaction = { observations: [], acceptedPhaseObserved: false, successfulFinalizationObserved: false }
  const { recordTransactionObservation } = await import('../../scripts/live-proof-store.mjs')
  recordTransactionObservation(transaction, { phase: 'ACCEPTED', observedAt: '2026-08-07T00:00:00Z' })
  assert.equal(transaction.acceptedPhaseObserved, true)
  assert.equal(transaction.finalized, null)
  recordTransactionObservation(transaction, { phase: 'FINALIZED', observedAt: '2026-08-07T00:00:01Z' })
  assert.equal(transaction.successfulFinalizationObserved, true)
  assert.equal(transaction.finalized.phase, 'FINALIZED')
})
