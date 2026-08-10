import {
  ExecutionResult,
  TransactionResult,
  TransactionStatus,
  executionResultNumberToName,
  transactionResultNumberToName,
  transactionsStatusNumberToName,
} from 'genlayer-js/types'
import { isTransientRpcFailure } from './live-rpc-error.mjs'

const statusNumberFallback = {
  ...transactionsStatusNumberToName,
  14: 'LEADER_REVEALING',
}
const resultNumberFallback = { ...transactionResultNumberToName }
const executionNumberFallback = {
  ...executionResultNumberToName,
  3: 'TIMEOUT',
  4: 'NONDET_DISAGREE',
}

const statusFailureReasons = {
  [TransactionStatus.UNDETERMINED]: 'Consensus ended without a determined transaction result.',
  [TransactionStatus.CANCELED]: 'The transaction was canceled before successful finalization.',
  [TransactionStatus.VALIDATORS_TIMEOUT]: 'Validators timed out before reaching a successful decision.',
  [TransactionStatus.LEADER_TIMEOUT]: 'The leader timed out before reaching a successful decision.',
}
const consensusFailureReasons = {
  [TransactionResult.MAJORITY_DISAGREE]: 'A validator majority disagreed with the leader result.',
  [TransactionResult.NO_MAJORITY]: 'Validators reached no majority result.',
  DETERMINISTIC_VIOLATION: 'Validators reported a deterministic execution violation.',
  MAJORITY_TIMEOUT: 'A validator majority timed out.',
  TIMEOUT: 'Consensus timed out.',
  NONDET_DISAGREE: 'Consensus ended with nondeterministic disagreement.',
  DISAGREE: 'Validators disagreed with the proposed result.',
  FAILURE: 'The transaction consensus result reported failure.',
}
const executionFailureReasons = {
  [ExecutionResult.FINISHED_WITH_ERROR]: 'Contract execution finished with an error.',
  TIMEOUT: 'Contract execution timed out.',
  NONDET_DISAGREE: 'Contract execution ended with nondeterministic disagreement.',
}

export const LIVE_FINALIZED_WAIT_RETRIES = 2160
export const LIVE_FINALIZED_WAIT_INTERVAL_MS = 5000
export const LIVE_TRANSIENT_RPC_RETRIES = 2160
export const LIVE_TRANSIENT_RPC_RETRY_INTERVAL_MS = 5000

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function normalizeNumber(value, mapping) {
  if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') return ''
  const key = String(value).trim()
  return /^\d+$/.test(key) ? (mapping[key] || '') : ''
}

async function waitWithTransientRetries({
  client,
  request,
  retries,
  interval,
  sleep,
  onTransientError,
}) {
  let attempt = 0
  for (;;) {
    try {
      return await client.waitForTransactionReceipt(request)
    } catch (error) {
      if (!isTransientRpcFailure(error) || attempt >= retries) throw error
      attempt += 1
      onTransientError({
        attempt,
        retries,
        message: error instanceof Error ? error.message : String(error),
      })
      await sleep(interval)
    }
  }
}

function receiptField(receipt, nameFields, numberFields, mapping) {
  for (const field of nameFields) {
    const name = normalizeName(receipt?.[field])
    if (name) return name
  }
  for (const field of numberFields) {
    const name = normalizeNumber(receipt?.[field], mapping)
    if (name) return name
  }
  return ''
}

export function classifyLiveReceipt(receipt) {
  const names = {
    statusName: receiptField(receipt, ['statusName', 'status_name'], ['status'], statusNumberFallback),
    resultName: receiptField(receipt, ['resultName', 'result_name'], ['result'], resultNumberFallback),
    executionResultName: receiptField(
      receipt,
      ['txExecutionResultName', 'tx_execution_result_name'],
      ['txExecutionResult', 'tx_execution_result'],
      executionNumberFallback,
    ),
  }
  const { statusName, resultName, executionResultName } = names
  if (statusFailureReasons[statusName]) {
    return { ...names, phase: 'FAILED', terminal: true, failureReason: statusFailureReasons[statusName] }
  }
  if (executionFailureReasons[executionResultName]) {
    return { ...names, phase: 'FAILED', terminal: true, failureReason: executionFailureReasons[executionResultName] }
  }
  if (consensusFailureReasons[resultName]) {
    return { ...names, phase: 'FAILED', terminal: true, failureReason: consensusFailureReasons[resultName] }
  }

  // Bradbury consensus-data currently exposes the successful result as AGREE;
  // SDK/local variants may expose the equivalent MAJORITY_AGREE name.
  const majority = resultName === TransactionResult.MAJORITY_AGREE
    || resultName === TransactionResult.AGREE
  const executionReturned = executionResultName === ExecutionResult.FINISHED_WITH_RETURN
  if (statusName === TransactionStatus.FINALIZED) {
    if (!majority) {
      return {
        ...names,
        phase: 'FAILED',
        terminal: true,
        failureReason: `Finalization occurred with consensus result ${resultName || 'UNKNOWN'}, not MAJORITY_AGREE.`,
      }
    }
    if (!executionReturned) {
      return {
        ...names,
        phase: 'FAILED',
        terminal: true,
        failureReason: `Finalization occurred with execution result ${executionResultName || 'UNKNOWN'}, not FINISHED_WITH_RETURN.`,
      }
    }
    return { ...names, phase: 'FINALIZED', terminal: true }
  }
  if (statusName === TransactionStatus.ACCEPTED && majority && executionReturned) {
    return { ...names, phase: 'ACCEPTED', terminal: false }
  }
  return {
    ...names,
    phase: statusName ? 'PROCESSING' : 'SUBMITTED',
    terminal: false,
  }
}

export function lifecycleObservation(receipt, requestedStatus, observedAt = new Date().toISOString()) {
  const classification = classifyLiveReceipt(receipt)
  return {
    observedAt,
    requestedStatus,
    ...classification,
  }
}

export async function waitForLiveLifecycle({
  client,
  hash,
  requestedAcceptedStatus = TransactionStatus.ACCEPTED,
  requestedFinalizedStatus = TransactionStatus.FINALIZED,
  acceptedOptions = {},
  finalizedOptions = {},
  now = () => new Date().toISOString(),
  onObservation = () => {},
  transientRetries = LIVE_TRANSIENT_RPC_RETRIES,
  transientRetryInterval = LIVE_TRANSIENT_RPC_RETRY_INTERVAL_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onTransientError = () => {},
}) {
  const observations = []
  const observe = (receipt, requestedStatus) => {
    const observation = lifecycleObservation(receipt, requestedStatus, now())
    observations.push(observation)
    onObservation(observation)
    return observation
  }

  const firstReceipt = await waitWithTransientRetries({
    client,
    request: {
      hash,
      status: requestedAcceptedStatus,
      ...acceptedOptions,
    },
    retries: transientRetries,
    interval: transientRetryInterval,
    sleep,
    onTransientError,
  })
  const first = observe(firstReceipt, requestedAcceptedStatus)
  if (first.phase === 'FAILED') {
    throw new Error(`Acceptance observation failed: ${first.failureReason}`)
  }

  let finalizedReceipt = firstReceipt
  let finalized = first
  if (first.phase !== 'FINALIZED') {
    finalizedReceipt = await waitWithTransientRetries({
      client,
      request: {
        hash,
        status: requestedFinalizedStatus,
        ...finalizedOptions,
      },
      retries: transientRetries,
      interval: transientRetryInterval,
      sleep,
      onTransientError,
    })
    finalized = observe(finalizedReceipt, requestedFinalizedStatus)
    if (finalized.phase === 'FAILED') {
      throw new Error(`Finalization observation failed: ${finalized.failureReason}`)
    }
  }

  if (finalized.phase !== 'FINALIZED') {
    throw new Error(
      `Finalization observation did not verify success: status=${finalized.statusName || 'UNKNOWN'}, consensus=${finalized.resultName || 'UNKNOWN'}, execution=${finalized.executionResultName || 'UNKNOWN'}`,
    )
  }

  const acceptedPhaseObserved = observations.some((item) => item.phase === 'ACCEPTED')
  return {
    finalizedReceipt,
    observations,
    acceptedPhaseObserved,
    successfulFinalizationObserved: true,
    separateAcceptedAndFinalizedObservations: acceptedPhaseObserved
      && observations.some((item) => item.phase === 'FINALIZED'),
  }
}
