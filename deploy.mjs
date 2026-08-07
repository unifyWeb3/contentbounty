import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAccount, createClient } from 'genlayer-js'
import {
  ExecutionResult,
  TransactionResult,
  TransactionStatus,
  executionResultNumberToName,
  transactionResultNumberToName,
  transactionsStatusNumberToName,
} from 'genlayer-js/types'
import { selectGenLayerNetwork } from './scripts/genlayer-network.mjs'

function gitValue(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unavailable'
  }
}

function normalizeReceiptField(receipt, nameFields, numberFields, mapping) {
  for (const field of nameFields) {
    const value = receipt?.[field]
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase()
  }
  for (const field of numberFields) {
    const value = receipt?.[field]
    if (value !== undefined && value !== null && mapping[String(value)]) return mapping[String(value)]
  }
  return ''
}

function summarizeReceipt(receipt) {
  return {
    statusName: normalizeReceiptField(
      receipt,
      ['statusName', 'status_name'],
      ['status'],
      transactionsStatusNumberToName,
    ),
    resultName: normalizeReceiptField(
      receipt,
      ['resultName', 'result_name'],
      ['result'],
      transactionResultNumberToName,
    ),
    executionResultName: normalizeReceiptField(
      receipt,
      ['txExecutionResultName', 'tx_execution_result_name'],
      ['txExecutionResult', 'tx_execution_result'],
      executionResultNumberToName,
    ),
  }
}

async function main() {
  const { name: networkSelector, chain } = selectGenLayerNetwork(process.env.GENLAYER_NETWORK)
  const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('Set GENLAYER_DEPLOYER_PRIVATE_KEY to a 0x-prefixed 32-byte key.')
  }

  const sourcePath = fileURLToPath(new URL('./contracts/content_bounty.py', import.meta.url))
  const code = readFileSync(sourcePath, 'utf8')
  const sourceDigest = createHash('sha256').update(code, 'utf8').digest('hex')
  const sourceCommit = gitValue(['rev-parse', 'HEAD'])
  const sourceDirty = gitValue(['status', '--porcelain', '--', 'contracts/content_bounty.py'])
  const rpcUrl = chain.rpcUrls.default.http[0]
  const explorerUrl = chain.blockExplorers.default.url.replace(/\/$/, '')
  const account = createAccount(privateKey)
  const client = createClient({ chain })

  console.log('Network selector:', networkSelector)
  console.log('Network name:', chain.name)
  console.log('Chain ID:', chain.id)
  console.log('RPC:', rpcUrl)
  console.log('Consensus contract:', chain.consensusMainContract.address)
  console.log('Explorer:', explorerUrl)
  console.log('Source:', sourcePath)
  console.log('Source SHA-256:', sourceDigest)
  console.log('Source commit:', sourceCommit)
  console.log('Contract source dirty:', sourceDirty === 'unavailable' ? 'unknown' : sourceDirty ? 'yes' : 'no')
  console.log('Deploying from:', account.address)

  const tx = await client.deployContract({ account, code, args: [] })
  console.log('Deployment transaction:', tx)
  console.log('Transaction explorer:', `${explorerUrl}/tx/${tx}`)
  console.log('Waiting for successful finalization...')

  const receipt = await client.waitForTransactionReceipt({
    hash: tx,
    status: TransactionStatus.FINALIZED,
    retries: 120,
    interval: 3000,
  })
  const summary = summarizeReceipt(receipt)
  console.log('Receipt classification:', JSON.stringify(summary))

  if (
    summary.statusName !== TransactionStatus.FINALIZED
    || summary.resultName !== TransactionResult.MAJORITY_AGREE
    || summary.executionResultName !== ExecutionResult.FINISHED_WITH_RETURN
  ) {
    throw new Error(
      `Deployment did not finalize successfully: status=${summary.statusName || 'UNKNOWN'}, consensus=${summary.resultName || 'UNKNOWN'}, execution=${summary.executionResultName || 'UNKNOWN'}.`,
    )
  }

  const address = receipt?.data?.contract_address
    ?? receipt?.contractAddress
    ?? receipt?.result?.contract_address
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Successful finalization receipt did not contain a valid contract address.')
  }

  console.log('DEPLOYED AND FINALIZED SUCCESSFULLY')
  console.log(`VITE_GENLAYER_NETWORK=${networkSelector}`)
  console.log(`VITE_CONTRACT_ADDRESS=${address}`)
  console.log('Contract explorer:', `${explorerUrl}/address/${address}`)
  console.log('Record the network, address, transaction hash, source commit, and source digest in IMPLEMENTATION_LOG.md.')
}

main().catch((error) => {
  console.error('Deployment failed:', error?.message ?? error)
  process.exitCode = 1
})
