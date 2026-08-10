import { describe, expect, it } from 'vitest'
import { ExecutionResult, TransactionResult, TransactionStatus } from 'genlayer-js/types'
import { classifyTransaction } from './transactionClassifier'

const successfulResult = {
  resultName: TransactionResult.MAJORITY_AGREE,
  txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
}

describe('classifyTransaction', () => {
  it.each([
    TransactionStatus.UNINITIALIZED,
    TransactionStatus.PENDING,
    TransactionStatus.PROPOSING,
    TransactionStatus.COMMITTING,
    TransactionStatus.REVEALING,
  ])('keeps %s non-terminal without claiming acceptance', (statusName) => {
    expect(classifyTransaction({ statusName })).toMatchObject({
      phase: statusName === TransactionStatus.UNINITIALIZED ? 'SUBMITTED' : 'PROCESSING',
      statusName,
      terminal: false,
    })
  })

  it.each([
    TransactionStatus.APPEAL_REVEALING,
    TransactionStatus.APPEAL_COMMITTING,
    TransactionStatus.READY_TO_FINALIZE,
    'LEADER_REVEALING',
  ])('treats %s as processing even when a successful vote is already visible', (statusName) => {
    expect(classifyTransaction({ statusName, ...successfulResult })).toMatchObject({
      phase: 'PROCESSING',
      statusName,
      terminal: false,
    })
  })

  it('requires majority agreement and successful execution for ACCEPTED', () => {
    expect(classifyTransaction({ statusName: TransactionStatus.ACCEPTED, ...successfulResult })).toMatchObject({
      phase: 'ACCEPTED',
      terminal: false,
    })
    expect(classifyTransaction({
      statusName: TransactionStatus.ACCEPTED,
      resultName: TransactionResult.MAJORITY_AGREE,
    })).toMatchObject({ phase: 'PROCESSING', terminal: false })
    expect(classifyTransaction({
      statusName: TransactionStatus.ACCEPTED,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    })).toMatchObject({ phase: 'PROCESSING', terminal: false })
  })

  it.each([
    [TransactionStatus.UNDETERMINED, 'without a determined'],
    [TransactionStatus.CANCELED, 'canceled'],
    [TransactionStatus.VALIDATORS_TIMEOUT, 'Validators timed out'],
    [TransactionStatus.LEADER_TIMEOUT, 'leader timed out'],
  ])('classifies terminal status %s as failure', (statusName, reason) => {
    expect(classifyTransaction({ statusName, ...successfulResult })).toMatchObject({
      phase: 'FAILED',
      statusName,
      terminal: true,
      failureReason: expect.stringContaining(reason),
    })
  })

  it.each([
    TransactionResult.MAJORITY_DISAGREE,
    TransactionResult.NO_MAJORITY,
    TransactionResult.DETERMINISTIC_VIOLATION,
    'MAJORITY_TIMEOUT',
    TransactionResult.TIMEOUT,
    TransactionResult.DISAGREE,
    TransactionResult.FAILURE,
  ])('fails explicit non-success consensus result %s', (resultName) => {
    expect(classifyTransaction({
      statusName: TransactionStatus.ACCEPTED,
      resultName,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    })).toMatchObject({ phase: 'FAILED', resultName, terminal: true })
  })

  it.each([
    ExecutionResult.FINISHED_WITH_ERROR,
    'TIMEOUT',
    'NONDET_DISAGREE',
  ])('fails explicit execution result %s even after finalization', (txExecutionResultName) => {
    expect(classifyTransaction({
      statusName: TransactionStatus.FINALIZED,
      resultName: TransactionResult.MAJORITY_AGREE,
      txExecutionResultName,
    })).toMatchObject({
      phase: 'FAILED',
      statusName: TransactionStatus.FINALIZED,
      executionResultName: txExecutionResultName,
      terminal: true,
    })
  })

  it('only reports successful finalization with both required results', () => {
    expect(classifyTransaction({ statusName: TransactionStatus.FINALIZED, ...successfulResult })).toEqual({
      phase: 'FINALIZED',
      statusName: TransactionStatus.FINALIZED,
      resultName: TransactionResult.MAJORITY_AGREE,
      executionResultName: ExecutionResult.FINISHED_WITH_RETURN,
      terminal: true,
    })
    expect(classifyTransaction({
      statusName: TransactionStatus.FINALIZED,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    })).toMatchObject({ phase: 'FAILED', failureReason: expect.stringContaining('MAJORITY_AGREE') })
    expect(classifyTransaction({
      statusName: TransactionStatus.FINALIZED,
      resultName: TransactionResult.MAJORITY_AGREE,
    })).toMatchObject({ phase: 'FAILED', failureReason: expect.stringContaining('successful execution') })
  })

  it('normalizes SDK numeric fields and legacy snake_case names', () => {
    expect(classifyTransaction({ status: 5, result: 6, txExecutionResult: 1 })).toMatchObject({
      phase: 'ACCEPTED',
      statusName: TransactionStatus.ACCEPTED,
      resultName: TransactionResult.MAJORITY_AGREE,
      executionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    })
    expect(classifyTransaction({
      status_name: 'finalized',
      result_name: 'majority_agree',
      tx_execution_result_name: 'finished_with_return',
    })).toMatchObject({ phase: 'FINALIZED' })
  })

  it('fails closed on unknown finalized result values', () => {
    expect(classifyTransaction({
      statusName: TransactionStatus.FINALIZED,
      resultName: 'SOMETHING_NEW',
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    })).toMatchObject({ phase: 'FAILED', failureReason: expect.stringContaining('SOMETHING_NEW') })
  })
})
