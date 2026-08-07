import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAccount, createClient } from 'genlayer-js'
import { ExecutionResult, TransactionResult, TransactionStatus } from 'genlayer-js/types'
import { selectGenLayerNetwork } from '../../scripts/genlayer-network.mjs'

const requiredNames = [
  'LIVE_DEPLOYER_PRIVATE_KEY',
  'LIVE_CREATOR_PRIVATE_KEY',
  'LIVE_APPROVE_EVIDENCE_URI',
  'LIVE_REJECT_EVIDENCE_URI',
  'LIVE_MUTABLE_EVIDENCE_URI',
  'LIVE_MUTATION_WEBHOOK_URL',
]

function requiredEnvironment() {
  const missing = requiredNames.filter((name) => !process.env[name]?.trim())
  if (missing.length) {
    throw new Error(`Live consensus test requires: ${missing.join(', ')}`)
  }
  for (const name of ['LIVE_DEPLOYER_PRIVATE_KEY', 'LIVE_CREATOR_PRIVATE_KEY']) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[name])) {
      throw new Error(`${name} must be a 0x-prefixed 32-byte key`)
    }
  }
  for (const name of requiredNames.filter((item) => item.endsWith('_URI') || item.endsWith('_URL'))) {
    if (!process.env[name].startsWith('https://')) throw new Error(`${name} must use HTTPS`)
  }
}

function receiptName(receipt, camel, snake) {
  return String(receipt?.[camel] ?? receipt?.[snake] ?? '').trim().toUpperCase()
}

function classifyReceipt(receipt) {
  return {
    statusName: receiptName(receipt, 'statusName', 'status_name'),
    resultName: receiptName(receipt, 'resultName', 'result_name'),
    executionResultName: receiptName(
      receipt,
      'txExecutionResultName',
      'tx_execution_result_name',
    ),
  }
}

function assertSuccessful(summary, expectedStatus, label) {
  if (
    summary.statusName !== expectedStatus
    || summary.resultName !== TransactionResult.MAJORITY_AGREE
    || summary.executionResultName !== ExecutionResult.FINISHED_WITH_RETURN
  ) {
    throw new Error(
      `${label} failed classification: status=${summary.statusName || 'UNKNOWN'}, consensus=${summary.resultName || 'UNKNOWN'}, execution=${summary.executionResultName || 'UNKNOWN'}`,
    )
  }
}

function explorerBase(chain) {
  return chain.blockExplorers.default.url.replace(/\/$/, '')
}

function proofJson(value) {
  return JSON.stringify(
    value,
    (_key, item) => typeof item === 'bigint' ? item.toString() : item,
    2,
  )
}

async function waitLifecycle(client, hash, label, chain, proof) {
  const acceptedReceipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 180,
    interval: 3000,
  })
  const accepted = classifyReceipt(acceptedReceipt)
  assertSuccessful(accepted, TransactionStatus.ACCEPTED, `${label} acceptance`)

  const finalizedReceipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 360,
    interval: 5000,
  })
  const finalized = classifyReceipt(finalizedReceipt)
  assertSuccessful(finalized, TransactionStatus.FINALIZED, `${label} finalization`)
  proof.transactions.push({
    label,
    hash,
    explorer: `${explorerBase(chain)}/tx/${hash}`,
    accepted,
    finalized,
  })
  return finalizedReceipt
}

async function readAll(client, address, functionName, leadingArgs = []) {
  const result = []
  for (let offset = 0; ; offset += 50) {
    const page = await client.readContract({
      address,
      functionName,
      args: [...leadingArgs, offset, 50],
    })
    result.push(...page)
    if (page.length < 50) return result
  }
}

async function writeAndFinalize(client, account, chain, proof, request, label) {
  const hash = await client.writeContract({ account, ...request })
  await waitLifecycle(client, hash, label, chain, proof)
  return hash
}

async function main() {
  requiredEnvironment()
  const { name: network, chain } = selectGenLayerNetwork(
    process.env.LIVE_GENLAYER_NETWORK || process.env.GENLAYER_NETWORK,
  )
  const deployer = createAccount(process.env.LIVE_DEPLOYER_PRIVATE_KEY)
  const creator = createAccount(process.env.LIVE_CREATOR_PRIVATE_KEY)
  if (deployer.address.toLowerCase() === creator.address.toLowerCase()) {
    throw new Error('Live deployer and creator accounts must be distinct for balance-delta proof')
  }
  const deployerClient = createClient({ chain, account: deployer })
  const creatorClient = createClient({ chain, account: creator })
  const sourcePath = fileURLToPath(new URL('../../contracts/content_bounty.py', import.meta.url))
  const code = readFileSync(sourcePath, 'utf8')
  const reward = BigInt(process.env.LIVE_REWARD_WEI || '1000000000000000')
  const proof = {
    generatedAt: new Date().toISOString(),
    network,
    chainId: chain.id,
    rpc: chain.rpcUrls.default.http[0],
    consensusContract: chain.consensusMainContract.address,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceSha256: createHash('sha256').update(code).digest('hex'),
    deployer: deployer.address,
    creator: creator.address,
    contractAddress: '',
    transactions: [],
    scenarios: {},
    unsupported: {
      fabricatedLeaderDisagreement: 'The public SDK/testnets expose no leader-result fabrication hook; use an authorized validator harness when GenLayer provides one.',
    },
  }

  const deploymentHash = await deployerClient.deployContract({ account: deployer, code, args: [] })
  const deploymentReceipt = await waitLifecycle(
    deployerClient,
    deploymentHash,
    'deploy v2.1',
    chain,
    proof,
  )
  const address = deploymentReceipt?.data?.contract_address
    ?? deploymentReceipt?.contractAddress
    ?? deploymentReceipt?.result?.contract_address
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Finalized deployment receipt did not contain a contract address')
  }
  proof.contractAddress = address
  proof.contractExplorer = `${explorerBase(chain)}/address/${address}`

  const rubric = JSON.stringify([
    { id: 'c1', requirement: 'The evidence explicitly contains the phrase CONTENT BOUNTY LIVE PASS.' },
    { id: 'c2', requirement: 'The evidence links to https://docs.genlayer.com/.' },
  ])

  async function postAndFind(title) {
    await writeAndFinalize(deployerClient, deployer, chain, proof, {
      address,
      functionName: 'post_bounty',
      args: [title, 'Live consensus integration evidence.', rubric, 3600, 3600],
      value: reward,
    }, `post ${title}`)
    const bounties = await readAll(deployerClient, address, 'get_bounties_page')
    return Number(bounties.at(-1).id)
  }

  async function submitAndFind(bountyId, uri, label) {
    await writeAndFinalize(creatorClient, creator, chain, proof, {
      address,
      functionName: 'submit_content',
      args: [bountyId, uri],
    }, label)
    const activity = await readAll(
      creatorClient,
      address,
      'get_creator_submissions_page',
      [creator.address],
    )
    return Number(activity.at(-1).id)
  }

  async function evaluateAndRead(submissionId, label) {
    await writeAndFinalize(deployerClient, deployer, chain, proof, {
      address,
      functionName: 'evaluate_submission',
      args: [submissionId],
    }, label)
    return deployerClient.readContract({
      address,
      functionName: 'get_submission',
      args: [submissionId],
    })
  }

  const rejectBounty = await postAndFind('Live clear rejection')
  const rejectSubmission = await submitAndFind(
    rejectBounty,
    process.env.LIVE_REJECT_EVIDENCE_URI,
    'submit clear rejection evidence',
  )
  const rejected = await evaluateAndRead(rejectSubmission, 'evaluate clear rejection')
  if (rejected.status !== 'REJECTED') throw new Error(`Expected REJECTED, got ${rejected.status}`)
  proof.scenarios.clearRejection = rejected

  const mutableBounty = await postAndFind('Live mutation inconclusive')
  const mutableSubmission = await submitAndFind(
    mutableBounty,
    process.env.LIVE_MUTABLE_EVIDENCE_URI,
    'submit mutable evidence',
  )
  const mutationResponse = await fetch(process.env.LIVE_MUTATION_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: process.env.LIVE_MUTABLE_EVIDENCE_URI }),
  })
  if (!mutationResponse.ok) throw new Error(`Mutation webhook failed with ${mutationResponse.status}`)
  const inconclusive = await evaluateAndRead(mutableSubmission, 'evaluate mutated evidence')
  if (
    inconclusive.status !== 'INCONCLUSIVE'
    || !['DIGEST_MISMATCH', 'FETCH_FAILED'].includes(inconclusive.reason_code)
  ) {
    throw new Error(`Expected mutation inconclusive, got ${inconclusive.status}/${inconclusive.reason_code}`)
  }
  proof.scenarios.inconclusiveMutation = inconclusive

  const approveBounty = await postAndFind('Live clear approval and payout')
  const approveSubmission = await submitAndFind(
    approveBounty,
    process.env.LIVE_APPROVE_EVIDENCE_URI,
    'submit clear approval evidence',
  )
  const balanceBefore = await creatorClient.getBalance({ address: creator.address })
  const approved = await evaluateAndRead(approveSubmission, 'evaluate clear approval')
  const balanceAfter = await creatorClient.getBalance({ address: creator.address })
  const balanceDelta = balanceAfter - balanceBefore
  if (approved.status !== 'APPROVED') throw new Error(`Expected APPROVED, got ${approved.status}`)
  if (balanceDelta !== reward) {
    throw new Error(`Expected finalized payout delta ${reward}, got ${balanceDelta}`)
  }
  proof.scenarios.clearApproval = approved
  proof.scenarios.finalizedPayout = {
    recipient: creator.address,
    balanceBefore: balanceBefore.toString(),
    balanceAfter: balanceAfter.toString(),
    balanceDelta: balanceDelta.toString(),
    expectedReward: reward.toString(),
  }

  const output = process.env.LIVE_PROOF_OUTPUT || '/tmp/contentbounty-live-consensus-proof.json'
  writeFileSync(output, `${proofJson(proof)}\n`, { mode: 0o600 })
  console.log(proofJson({ output, ...proof }))
}

main().catch((error) => {
  console.error('Live consensus integration failed:', error?.message ?? error)
  process.exitCode = 1
})
