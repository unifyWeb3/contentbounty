import { createHash } from 'node:crypto'
import {
  ExecutionResult,
  TransactionResult,
  TransactionStatus,
  executionResultNumberToName,
  transactionResultNumberToName,
  transactionsStatusNumberToName,
} from 'genlayer-js/types'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const SHA256_RE = /^[0-9a-fA-F]{64}$/

async function withTransientRetries(operation, {
  retries = 5,
  interval = 2000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= retries) throw error
      attempt += 1
      await sleep(interval)
    }
  }
}

function normalizeAddress(value, label) {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be a 20-byte 0x-prefixed address`)
  }
  return value
}

function normalizeHash(value, label) {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw new Error(`${label} must be a 32-byte 0x-prefixed transaction id`)
  }
  return value.toLowerCase()
}

function sourceSha256(code) {
  if (typeof code !== 'string' || !code) throw new Error('Recovered deployment calldata did not contain source code')
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

function normalizedField(transaction, nameFields, numberFields, mapping) {
  for (const field of nameFields) {
    const value = transaction?.[field]
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase()
  }
  for (const field of numberFields) {
    const value = transaction?.[field]
    const key = value === undefined || value === null ? '' : String(value).trim()
    if (/^\d+$/.test(key) && mapping[key]) return mapping[key]
  }
  return ''
}

function receiptFromTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object') throw new Error('Bradbury returned no consensus transaction data')
  const lifecycle = {
    statusName: normalizedField(transaction, ['statusName', 'status_name'], ['status'], transactionsStatusNumberToName),
    resultName: normalizedField(transaction, ['resultName', 'result_name'], ['result'], transactionResultNumberToName),
    executionResultName: normalizedField(
      transaction,
      ['txExecutionResultName', 'tx_execution_result_name'],
      ['txExecutionResult', 'tx_execution_result'],
      executionResultNumberToName,
    ),
  }
  if (lifecycle.statusName !== TransactionStatus.FINALIZED) {
    throw new Error(`Recovered deployment is not FINALIZED: ${lifecycle.statusName || 'UNKNOWN'}`)
  }
  if (lifecycle.resultName !== TransactionResult.AGREE) {
    throw new Error(`Recovered deployment consensus is not AGREE: ${lifecycle.resultName || 'UNKNOWN'}`)
  }
  if (lifecycle.executionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`Recovered deployment execution did not finish with return: ${lifecycle.executionResultName || 'UNKNOWN'}`)
  }
  return { ...lifecycle, phase: 'FINALIZED' }
}

export async function recoverFinalizedDeployment({
  client,
  deploymentTransaction,
  contractAddress,
  expectedSourceSha256,
  transientRetries = 5,
  transientRetryInterval = 2000,
  sleep,
}) {
  const txId = normalizeHash(deploymentTransaction, 'LIVE_DEPLOYMENT_TRANSACTION')
  const expectedAddress = normalizeAddress(contractAddress, 'LIVE_DEPLOYED_CONTRACT_ADDRESS')
  if (typeof expectedSourceSha256 !== 'string' || !SHA256_RE.test(expectedSourceSha256)) {
    throw new Error('Expected deployment source SHA-256 is invalid')
  }

  let transaction
  try {
    transaction = await withTransientRetries(
      () => client.getTransaction({ hash: txId }),
      { retries: transientRetries, interval: transientRetryInterval, sleep },
    )
  } catch (error) {
    throw new Error(`Bradbury consensus-data lookup failed: ${error?.message ?? error}`)
  }
  const lifecycle = receiptFromTransaction(transaction)
  const decoded = transaction.txDataDecoded
  if (!decoded || decoded.type !== 'deploy') {
    throw new Error('Recovered transaction is not a deployment transaction')
  }
  const recoveredAddress = normalizeAddress(decoded.contractAddress, 'Recovered deployment contract address')
  if (recoveredAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`Recovered contract address mismatch: expected ${expectedAddress}, got ${recoveredAddress}`)
  }
  const observedSourceSha256 = sourceSha256(decoded.code)
  if (observedSourceSha256.toLowerCase() !== expectedSourceSha256.toLowerCase()) {
    throw new Error(`Recovered deployment source SHA-256 mismatch: expected ${expectedSourceSha256}, got ${observedSourceSha256}`)
  }

  return {
    transactionId: txId,
    contractAddress: expectedAddress,
    sourceSha256: observedSourceSha256,
    lifecycle: {
      statusName: lifecycle.statusName,
      resultName: lifecycle.resultName,
      executionResultName: lifecycle.executionResultName,
      phase: lifecycle.phase,
    },
    transaction,
  }
}

export function validateRecoveryProofArtifact(proof, {
  network,
  deploymentTransaction,
  contractAddress,
  sourceSha256: expectedSourceSha256,
  deployer,
  creator,
}) {
  if (!proof || typeof proof !== 'object') return null
  const expectedTransaction = normalizeHash(deploymentTransaction, 'LIVE_EXISTING_DEPLOYMENT_TRANSACTION')
  const expectedAddress = normalizeAddress(contractAddress, 'LIVE_EXISTING_CONTRACT_ADDRESS')
  const checks = [
    [proof.network === network, 'network'],
    [proof.sourceSha256?.toLowerCase() === expectedSourceSha256.toLowerCase(), 'source SHA-256'],
    [proof.deployer?.toLowerCase() === deployer.toLowerCase(), 'deployer account'],
    [proof.creator?.toLowerCase() === creator.toLowerCase(), 'creator account'],
  ]
  if (proof.contractAddress) {
    checks.push([proof.contractAddress.toLowerCase() === expectedAddress.toLowerCase(), 'contract address'])
  }
  const recordedDeployment = proof.recoveredDeployment?.transaction
    ?? proof.scenarios?.deployment?.hash
    ?? proof.transactions?.find((item) => item.recovered)?.hash
  if (recordedDeployment) {
    checks.push([recordedDeployment.toLowerCase() === expectedTransaction, 'deployment transaction'])
  }
  const mismatch = checks.find(([ok]) => !ok)
  if (mismatch) throw new Error(`Existing proof artifact recovery ${mismatch[1]} mismatch`)
  return proof
}
