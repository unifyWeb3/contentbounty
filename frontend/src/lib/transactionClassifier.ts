import {
  ExecutionResult,
  TransactionResult,
  TransactionStatus,
  executionResultNumberToName,
  transactionResultNumberToName,
  transactionsStatusNumberToName,
} from 'genlayer-js/types'

export type TransactionPhase = 'SUBMITTED' | 'PROCESSING' | 'ACCEPTED' | 'FINALIZED' | 'FAILED'

export interface TransactionLike {
  status?: unknown
  statusName?: unknown
  status_name?: unknown
  result?: unknown
  resultName?: unknown
  result_name?: unknown
  txExecutionResult?: unknown
  tx_execution_result?: unknown
  txExecutionResultName?: unknown
  tx_execution_result_name?: unknown
}

export interface TransactionClassification {
  phase: TransactionPhase
  statusName: string
  resultName: string
  executionResultName: string
  failureReason?: string
  terminal: boolean
}

const statusNumberFallback: Record<string, string> = {
  ...transactionsStatusNumberToName,
  14: 'LEADER_REVEALING',
}

const resultNumberFallback: Record<string, string> = {
  ...transactionResultNumberToName,
}

const executionNumberFallback: Record<string, string> = {
  ...executionResultNumberToName,
  3: 'TIMEOUT',
  4: 'NONDET_DISAGREE',
}

const terminalStatusReasons: Record<string, string> = {
  [TransactionStatus.UNDETERMINED]: 'Consensus ended without a determined transaction result.',
  [TransactionStatus.CANCELED]: 'The transaction was canceled before successful finalization.',
  [TransactionStatus.VALIDATORS_TIMEOUT]: 'Validators timed out before reaching a successful decision.',
  [TransactionStatus.LEADER_TIMEOUT]: 'The leader timed out before reaching a successful decision.',
}

const consensusFailureReasons: Record<string, string> = {
  [TransactionResult.MAJORITY_DISAGREE]: 'A validator majority disagreed with the leader result.',
  [TransactionResult.NO_MAJORITY]: 'Validators reached no majority result.',
  DETERMINISTIC_VIOLATION: 'Validators reported a deterministic execution violation.',
  MAJORITY_TIMEOUT: 'A validator majority timed out.',
  TIMEOUT: 'Consensus timed out.',
  DISAGREE: 'Validators disagreed with the proposed result.',
  FAILURE: 'The transaction consensus result reported failure.',
}

const executionFailureReasons: Record<string, string> = {
  [ExecutionResult.FINISHED_WITH_ERROR]: 'Contract execution finished with an error.',
  TIMEOUT: 'Contract execution timed out.',
  NONDET_DISAGREE: 'Contract execution ended with nondeterministic disagreement.',
}

function normalizeName(value: unknown): string {
  if (typeof value === 'string') return value.trim().toUpperCase()
  return ''
}

function normalizeNumber(value: unknown, mapping: Record<string, string>): string {
  if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') return ''
  const key = String(value).trim()
  if (!/^\d+$/.test(key)) return ''
  return mapping[key] ?? ''
}

function fieldName(
  transaction: TransactionLike,
  nameFields: Array<keyof TransactionLike>,
  numberFields: Array<keyof TransactionLike>,
  mapping: Record<string, string>,
): string {
  for (const field of nameFields) {
    const normalized = normalizeName(transaction[field])
    if (normalized) return normalized
  }
  for (const field of numberFields) {
    const normalized = normalizeNumber(transaction[field], mapping)
    if (normalized) return normalized
  }
  return ''
}

function observedNames(transaction: TransactionLike) {
  return {
    statusName: fieldName(
      transaction,
      ['statusName', 'status_name'],
      ['status'],
      statusNumberFallback,
    ),
    resultName: fieldName(
      transaction,
      ['resultName', 'result_name'],
      ['result'],
      resultNumberFallback,
    ),
    executionResultName: fieldName(
      transaction,
      ['txExecutionResultName', 'tx_execution_result_name'],
      ['txExecutionResult', 'tx_execution_result'],
      executionNumberFallback,
    ),
  }
}

export function classifyTransaction(transaction: TransactionLike): TransactionClassification {
  const names = observedNames(transaction)
  const { statusName, resultName, executionResultName } = names

  const statusFailure = terminalStatusReasons[statusName]
  if (statusFailure) {
    return { ...names, phase: 'FAILED', failureReason: statusFailure, terminal: true }
  }

  const executionFailure = executionFailureReasons[executionResultName]
  if (executionFailure) {
    return { ...names, phase: 'FAILED', failureReason: executionFailure, terminal: true }
  }

  const consensusFailure = consensusFailureReasons[resultName]
  if (consensusFailure) {
    return { ...names, phase: 'FAILED', failureReason: consensusFailure, terminal: true }
  }

  const successfulConsensus = resultName === TransactionResult.MAJORITY_AGREE
  const successfulExecution = executionResultName === ExecutionResult.FINISHED_WITH_RETURN

  if (statusName === TransactionStatus.FINALIZED) {
    if (!successfulConsensus) {
      return {
        ...names,
        phase: 'FAILED',
        failureReason: resultName
          ? `Finalization occurred with consensus result ${resultName}, not MAJORITY_AGREE.`
          : 'Finalization occurred without a verifiable MAJORITY_AGREE result.',
        terminal: true,
      }
    }
    if (!successfulExecution) {
      return {
        ...names,
        phase: 'FAILED',
        failureReason: executionResultName
          ? `Finalization occurred with execution result ${executionResultName}, not FINISHED_WITH_RETURN.`
          : 'Finalization occurred without a verifiable successful execution result.',
        terminal: true,
      }
    }
    return { ...names, phase: 'FINALIZED', terminal: true }
  }

  if (statusName === TransactionStatus.ACCEPTED) {
    if (successfulConsensus && successfulExecution) {
      return { ...names, phase: 'ACCEPTED', terminal: false }
    }
    return { ...names, phase: 'PROCESSING', terminal: false }
  }

  if (!statusName || statusName === TransactionStatus.UNINITIALIZED) {
    return { ...names, phase: 'SUBMITTED', terminal: false }
  }

  return { ...names, phase: 'PROCESSING', terminal: false }
}

export function isVerifiedSuccessfulFinalization(transaction: TransactionLike): boolean {
  return classifyTransaction(transaction).phase === 'FINALIZED'
}
