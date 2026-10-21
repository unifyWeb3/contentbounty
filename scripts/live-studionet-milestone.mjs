/**
 * Live Milestone-1 proof on GenLayer Studionet.
 *
 * Every key is read from the environment; nothing is written to disk and no
 * key material is ever printed. Only addresses, transaction hashes, balances
 * and contract reads are printed.
 *
 *   node scripts/live-studionet-milestone.mjs --stage deploy
 *   node scripts/live-studionet-milestone.mjs --stage post
 *   node scripts/live-studionet-milestone.mjs --stage submit --evidence <url>
 *   node scripts/live-studionet-milestone.mjs --stage evaluate
 *   node scripts/live-studionet-milestone.mjs --stage claim
 *   node scripts/live-studionet-milestone.mjs --stage withdraw
 *   node scripts/live-studionet-milestone.mjs --stage refusals
 *   node scripts/live-studionet-milestone.mjs --stage challenge
 *   node scripts/live-studionet-milestone.mjs --stage injected --evidence <url>
 *   node scripts/live-studionet-milestone.mjs --stage refund
 *
 * The Studionet faucet mints simulated GEN. Balances printed here prove the
 * escrow mechanics, not value.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAccount, createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'
import { keccak256, toHex } from 'viem'

const RPC = studionet.rpcUrls.default.http[0]
const CHAIN_ID = 61999
const STATE_PATH = fileURLToPath(new URL('../.secrets/live-studionet-state.json', import.meta.url))
const CONTRACT_PATH = fileURLToPath(new URL('../contracts/content_bounty.py', import.meta.url))

const REWARD = 10n ** 18n
const CHALLENGE_WINDOW_SECONDS = 300
const SUBMISSION_WINDOW_SECONDS = 3600
const EVALUATION_GRACE_SECONDS = 3600

function requireKey(name) {
  const value = process.env[name]
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte key.`)
  }
  return value
}

const deployer = createAccount(requireKey('GENLAYER_DEPLOYER_PRIVATE_KEY'))
const creator = createAccount(requireKey('GENLAYER_CREATOR_PRIVATE_KEY'))
const challenger = createAccount(requireKey('GENLAYER_CHALLENGER_PRIVATE_KEY'))

const client = createClient({ chain: studionet })

async function rpc(method, params) {
  let lastError = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      return await response.json()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)))
    }
  }
  throw lastError
}

async function balanceOf(address) {
  const result = await rpc('eth_getBalance', [address, 'latest'])
  if (result.error) throw new Error(`balance read failed: ${JSON.stringify(result.error)}`)
  return BigInt(result.result ?? '0x0')
}

async function fundAll() {
  for (const account of [deployer, creator, challenger]) {
    const response = await rpc('sim_fundAccount', [account.address, 1000])
    console.log(`sim_fundAccount ${account.address} ->`, JSON.stringify(response))
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch }
  writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), { mode: 0o600 })
}

function claimTagFor(bountyId, creatorAddress, contract) {
  const payload = [
    'content-bounty-claim-tag',
    'version=v1',
    `chain_id=${CHAIN_ID}`,
    `contract=${contract.toLowerCase()}`,
    `bounty_id=${bountyId}`,
    `creator=${creatorAddress.toLowerCase()}`,
  ].join('|')
  return 'cb-' + keccak256(toHex(payload)).slice(2, 22)
}

function executionOf(receipt) {
  const leader = receipt?.consensus_data?.leader_receipt?.[0]
  if (leader?.execution_result) return String(leader.execution_result).toUpperCase()
  return String(
    receipt?.txExecutionResultName ?? receipt?.txExecutionResult ?? receipt?.data?.execution_result ?? 'UNKNOWN',
  ).toUpperCase()
}

function errorOf(receipt) {
  const stderr = receipt?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr ?? ''
  const match = stderr.match(/AssertionError: ([^\n]+)/)
  if (match) return match[1]
  return stderr.split('\\n').filter(Boolean).slice(-1)[0] ?? ''
}

async function waitFinalized(hash, label) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 300,
    interval: 3000,
  })
  const summary = {
    tx: hash,
    status: receipt.status_name ?? receipt.status_name ?? receipt.statusName ?? receipt.status,
    consensus: receipt.result_name ?? receipt.resultName ?? receipt.result,
    execution: executionOf(receipt),
    error: errorOf(receipt),
  }
  console.log(`[${label}]`, JSON.stringify(summary))
  return { receipt, summary }
}

async function write({ account, contract, functionName, args = [], value = 0n, label }) {
  const hash = await client.writeContract({
    account,
    address: contract,
    functionName,
    args,
    value,
  })
  console.log(`[${label}] submitted`, hash)
  const { receipt, summary } = await waitFinalized(hash, label)
  const execution = executionOf(receipt)
  return { hash, summary, execution, error: errorOf(receipt) }
}

async function read(contract, functionName, args = []) {
  return client.readContract({ address: contract, functionName, args })
}

async function nextBountyId(contract) {
  const page = await read(contract, 'get_bounties_page', [0, 50])
  return page.length
}

async function nextSubmissionId(contract) {
  const accounting = await read(contract, 'get_escrow_accounting')
  return accounting.submission_count
}

async function nextChallengeId(contract) {
  const accounting = await read(contract, 'get_escrow_accounting')
  return accounting.challenge_count + 1
}

async function expectRevert({ account, contract, functionName, args = [], value = 0n, label }) {
  try {
    const hash = await client.writeContract({ account, address: contract, functionName, args, value })
    const receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      retries: 200,
      interval: 3000,
    })
    const execution = executionOf(receipt)
    const failed = execution.includes('ERROR')
    console.log(`[${label}] tx=${hash} execution=${execution} rejected=${failed} error=${errorOf(receipt)}`)
    return { hash, rejected: failed, execution, error: errorOf(receipt) }
  } catch (error) {
    console.log(`[${label}] client-side rejection:`, error?.shortMessage ?? error?.message)
    return { hash: null, rejected: true, error: String(error?.shortMessage ?? error?.message) }
  }
}

const args = process.argv.slice(2)
const stage = args[args.indexOf('--stage') + 1]
const evidenceUrl = args[args.indexOf('--evidence') + 1]
const challengeUrl = args[args.indexOf('--challenge') + 1]
const injectedUrl = args[args.indexOf('--injected') + 1]

const state = readState()

if (stage === 'deploy') {
  await fundAll()
  const code = readFileSync(CONTRACT_PATH, 'utf8')
  const sourceDigest = createHash('sha256').update(code, 'utf8').digest('hex')
  console.log('source sha256', sourceDigest, 'bytes', Buffer.byteLength(code))
  const hash = await client.deployContract({ account: deployer, code, args: [] })
  const { receipt } = await waitFinalized(hash, 'deploy')
  const address = receipt.data?.contract_address ?? receipt.contractAddress
  console.log('CONTRACT_ADDRESS', address)
  const readback = await rpc('gen_getContractCode', [address])
  const decoded = Buffer.from(readback.result, 'base64')
  const deployedDigest = createHash('sha256').update(decoded).digest('hex')
  console.log('deployed bytes', decoded.length, 'deployed sha256', deployedDigest)
  console.log('BYTE_IDENTICAL', decoded.equals(Buffer.from(code, 'utf8')))
  writeState({ contract: address, sourceDigest, deployedDigest, deploymentTx: hash })
} else if (stage === 'post') {
  const contract = state.contract
  const rubric = JSON.stringify([
    { id: 'c1', requirement: 'The evidence names GenLayer.' },
    { id: 'c2', requirement: 'The evidence includes an official GenLayer documentation URL.' },
  ])
  const bountyId = await nextBountyId(contract)
  const result = await write({
    account: deployer,
    contract,
    functionName: 'post_bounty',
    args: [
      'ContentBounty v2.3 milestone proof',
      'Closed-set verdicts and pull-based settlement, proven live on Studionet.',
      rubric,
      BigInt(SUBMISSION_WINDOW_SECONDS),
      BigInt(EVALUATION_GRACE_SECONDS),
      BigInt(CHALLENGE_WINDOW_SECONDS),
    ],
    value: REWARD,
    label: 'post_bounty',
  })
  const bounty = await read(contract, 'get_bounty', [bountyId])
  const tag = claimTagFor(bountyId, creator.address, contract)
  console.log('bounty', JSON.stringify(bounty))
  console.log('creator claim tag for bounty', bountyId, ':', tag)
  writeState({ bountyId, postTx: result.hash, claimTag: tag })
} else if (stage === 'submit') {
  const contract = state.contract
  const result = await write({
    account: creator,
    contract,
    functionName: 'submit_content',
    args: [BigInt(state.bountyId ?? 0), evidenceUrl],
    label: 'submit_content',
  })
  const submission = await read(contract, 'get_submission', [BigInt(state.submissionId ?? 0)])
  console.log('submission', JSON.stringify(submission))
  writeState({ submissionId: 0, submitTx: result.hash })
} else if (stage === 'evaluate') {
  const contract = state.contract
  const result = await write({
    account: creator,
    contract,
    functionName: 'evaluate_submission',
    args: [BigInt(state.submissionId ?? 0)],
    label: 'evaluate_submission',
  })
  const submission = await read(contract, 'get_submission', [BigInt(state.submissionId ?? 0)])
  const verdict = await read(contract, 'get_submission_verdict', [BigInt(state.submissionId ?? 0)])
  console.log('submission', JSON.stringify(submission))
  console.log('verdict', JSON.stringify(verdict))
  writeState({ evaluateTx: result.hash, verdict })
} else if (stage === 'claim') {
  const contract = state.contract
  const before = await balanceOf(creator.address)
  const result = await write({
    account: creator,
    contract,
    functionName: 'claim_reward',
    args: [BigInt(state.submissionId ?? 0)],
    label: 'claim_reward',
  })
  const after = await balanceOf(creator.address)
  console.log('creator balance before claim', before.toString(), 'after claim', after.toString())
  const accounting = await read(contract, 'get_escrow_accounting')
  console.log('escrow accounting', JSON.stringify(accounting))
  writeState({ claimTx: result.hash, balanceAfterClaim: after.toString() })
} else if (stage === 'withdraw') {
  const contract = state.contract
  const before = await balanceOf(creator.address)
  const result = await write({
    account: creator,
    contract,
    functionName: 'withdraw_reward',
    args: [BigInt(state.submissionId ?? 0)],
    label: 'withdraw_reward',
  })
  const after = await balanceOf(creator.address)
  console.log('creator balance before withdraw', before.toString(), 'after withdraw', after.toString())
  console.log('delta', (after - before).toString())
  const accounting = await read(contract, 'get_escrow_accounting')
  console.log('escrow accounting', JSON.stringify(accounting))
  writeState({ withdrawTx: result.hash, balanceAfterWithdraw: after.toString() })
} else if (stage === 'refusals') {
  const contract = state.contract
  await expectRevert({
    account: creator,
    contract,
    functionName: 'withdraw_reward',
    args: [BigInt(state.submissionId ?? 0)],
    label: 'refusal: double withdraw',
  })
  await expectRevert({
    account: challenger,
    contract,
    functionName: 'withdraw_reward',
    args: [BigInt(state.submissionId ?? 0)],
    label: 'refusal: wrong withdrawal recipient',
  })
  await expectRevert({
    account: creator,
    contract,
    functionName: 'claim_reward',
    args: [BigInt(state.submissionId ?? 0)],
    label: 'refusal: double claim',
  })
  await expectRevert({
    account: creator,
    contract,
    functionName: 'challenge_submission',
    args: [BigInt(state.submissionId ?? 0), 'RIGHTS_OR_PLAGIARISM', challengeUrl ?? evidenceUrl],
    value: 10n ** 16n,
    label: 'refusal: creator challenges own submission',
  })
  await expectRevert({
    account: challenger,
    contract,
    functionName: 'challenge_submission',
    args: [BigInt(state.submissionId ?? 0), 'RIGHTS_OR_PLAGIARISM', challengeUrl ?? evidenceUrl],
    value: 10n ** 15n,
    label: 'refusal: wrong challenge bond',
  })
  await expectRevert({
    account: challenger,
    contract,
    functionName: 'challenge_submission',
    args: [BigInt(state.submissionId ?? 0), 'NOT_A_REASON', challengeUrl ?? evidenceUrl],
    value: 5n * 10n ** 16n,
    label: 'refusal: invalid challenge reason',
  })
} else if (stage === 'challenge-post') {
  const contract = state.contract
  const rubric = JSON.stringify([
    { id: 'c1', requirement: 'The evidence names GenLayer.' },
    { id: 'c2', requirement: 'The evidence includes an official GenLayer documentation URL.' },
  ])
  const bountyId = await nextBountyId(contract)
  const post = await write({
    account: deployer,
    contract,
    functionName: 'post_bounty',
    args: [
      'ContentBounty v2.3 challenge window proof',
      'A compliant submission that a third party disputes before the payout.',
      rubric,
      BigInt(SUBMISSION_WINDOW_SECONDS),
      BigInt(EVALUATION_GRACE_SECONDS),
      BigInt(CHALLENGE_WINDOW_SECONDS),
    ],
    value: REWARD,
    label: 'post_bounty (challenge scenario)',
  })
  const tag = claimTagFor(bountyId, creator.address, contract)
  console.log('creator claim tag for bounty', bountyId, ':', tag)
  writeState({ challengeBountyId: bountyId, challengeTag: tag, challengePostTx: post.hash })
} else if (stage === 'challenge-submit') {
  const contract = state.contract
  const bountyId = state.challengeBountyId
  const submit = await write({
    account: creator,
    contract,
    functionName: 'submit_content',
    args: [BigInt(bountyId), evidenceUrl],
    label: 'submit_content (challenge scenario)',
  })
  const submissionId = await nextSubmissionId(contract)
  const evaluate = await write({
    account: creator,
    contract,
    functionName: 'evaluate_submission',
    args: [BigInt(submissionId)],
    label: 'evaluate_submission (challenge scenario)',
  })
  const submission = await read(contract, 'get_submission', [BigInt(submissionId)])
  console.log('challenge scenario submission', JSON.stringify(submission))
  writeState({ challengeSubmissionId: submissionId, challengeSubmitTx: submit.hash, challengeEvaluateTx: evaluate.hash })
} else if (stage === 'challenge') {
  const contract = state.contract
  const submissionId = state.challengeSubmissionId
  const bond = BigInt(await read(contract, 'get_challenge_bond', [BigInt(submissionId)]))
  console.log('challenge bond', bond.toString())
  const challenge = await write({
    account: challenger,
    contract,
    functionName: 'challenge_submission',
    args: [BigInt(submissionId), 'RIGHTS_OR_PLAGIARISM', challengeUrl],
    value: bond,
    label: 'challenge_submission',
  })
  const challengeId = await nextChallengeId(contract)
  const review = await write({
    account: challenger,
    contract,
    functionName: 'review_challenge',
    args: [BigInt(challengeId)],
    label: 'review_challenge',
  })
  const record = await read(contract, 'get_challenge', [BigInt(challengeId)])
  if (record.proposed_outcome !== 'UPHOLD' && record.proposed_outcome !== 'DISMISS') {
    console.log('review did not reach a final proposal:', JSON.stringify(record))
    writeState({ challengeTx: challenge.hash, reviewTx: review.hash })
  } else {
    const finalized = await write({
      account: challenger,
      contract,
      functionName: 'finalize_challenge',
      args: [BigInt(challengeId)],
      label: 'finalize_challenge',
    })
    const settled = await read(contract, 'get_challenge', [BigInt(challengeId)])
    console.log('challenge', JSON.stringify(settled))
    const recipient = settled.bond_recipient.toLowerCase()
    const recipientAccount = recipient === creator.address.toLowerCase()
      ? creator
      : recipient === challenger.address.toLowerCase() ? challenger : null
    if (!recipientAccount) {
      console.log('unexpected bond recipient', recipient)
    } else {
      const before = await balanceOf(recipientAccount.address)
      const withdraw = await write({
        account: recipientAccount,
        contract,
        functionName: 'withdraw_bond',
        args: [BigInt(challengeId)],
        label: 'withdraw_bond',
      })
      const after = await balanceOf(recipientAccount.address)
      console.log('bond recipient', recipientAccount.address, 'balance before', before.toString(), 'after', after.toString(), 'delta', (after - before).toString())
      writeState({ withdrawBondTx: withdraw.hash })
    }
    writeState({ challengeTx: challenge.hash, reviewTx: review.hash, finalizeTx: finalized.hash })
  }
} else if (stage === 'injected') {
  const contract = state.contract
  const rubric = JSON.stringify([
    { id: 'c1', requirement: 'The evidence names GenLayer.' },
    { id: 'c2', requirement: 'The evidence includes an official GenLayer documentation URL.' },
  ])
  const bountyId = await nextBountyId(contract)
  const post = await write({
    account: deployer,
    contract,
    functionName: 'post_bounty',
    args: [
      'ContentBounty v2.3 injected submission refusal proof',
      'A submission that carries a prompt injection attempt and satisfies no criterion.',
      rubric,
      BigInt(SUBMISSION_WINDOW_SECONDS),
      BigInt(EVALUATION_GRACE_SECONDS),
      BigInt(CHALLENGE_WINDOW_SECONDS),
    ],
    value: REWARD,
    label: 'post_bounty (injected scenario)',
  })
  const tag = claimTagFor(bountyId, creator.address, contract)
  console.log('creator claim tag for bounty', bountyId, ':', tag)
  writeState({ injectedBountyId: bountyId, injectedTag: tag, injectedPostTx: post.hash })
} else if (stage === 'injected-submit') {
  const contract = state.contract
  const submit = await write({
    account: creator,
    contract,
    functionName: 'submit_content',
    args: [BigInt(state.injectedBountyId), injectedUrl],
    label: 'submit_content (injected scenario)',
  })
  const injectedSubmissionId = await nextSubmissionId(contract)
  const evaluate = await write({
    account: creator,
    contract,
    functionName: 'evaluate_submission',
    args: [BigInt(injectedSubmissionId)],
    label: 'evaluate_submission (injected scenario)',
  })
  state.injectedSubmissionId = injectedSubmissionId
  const submission = await read(contract, 'get_submission', [BigInt(state.injectedSubmissionId)])
  console.log('injected submission', JSON.stringify(submission))
  writeState({ injectedSubmitTx: submit.hash, injectedEvaluateTx: evaluate.hash })
} else if (stage === 'refund') {
  const contract = state.contract
  const rubric = JSON.stringify([
    { id: 'c1', requirement: 'The evidence names GenLayer.' },
    { id: 'c2', requirement: 'The evidence includes an official GenLayer documentation URL.' },
  ])
  const bountyId = await nextBountyId(contract)
  const post = await write({
    account: deployer,
    contract,
    functionName: 'post_bounty',
    args: [
      'ContentBounty v2.3 refund proof',
      'An untouched bounty that is cancelled and refunded through the pull path.',
      rubric,
      BigInt(SUBMISSION_WINDOW_SECONDS),
      BigInt(EVALUATION_GRACE_SECONDS),
      BigInt(CHALLENGE_WINDOW_SECONDS),
    ],
    value: REWARD,
    label: 'post_bounty (refund scenario)',
  })
  const before = await balanceOf(deployer.address)
  const cancel = await write({
    account: deployer,
    contract,
    functionName: 'cancel_bounty',
    args: [BigInt(bountyId)],
    label: 'cancel_bounty',
  })
  const mid = await balanceOf(deployer.address)
  const withdraw = await write({
    account: deployer,
    contract,
    functionName: 'withdraw_refund',
    args: [BigInt(bountyId)],
    label: 'withdraw_refund',
  })
  const after = await balanceOf(deployer.address)
  console.log('poster balance before', before.toString(), 'after cancel', mid.toString(), 'after withdraw', after.toString())
  const accounting = await read(contract, 'get_escrow_accounting')
  console.log('escrow accounting', JSON.stringify(accounting))
  writeState({ refundPostTx: post.hash, cancelTx: cancel.hash, withdrawRefundTx: withdraw.hash })
} else {
  console.error('Unknown or missing --stage')
  process.exitCode = 1
}
