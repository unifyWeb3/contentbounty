import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { classifyLiveReceipt } from './live-lifecycle.mjs'
import { EXPECTED_PAYOUT_WEI, validatePublicLiveProof } from './export_live_proof.mjs'

const DEFAULT_PUBLIC_PROOF = fileURLToPath(new URL('../docs/proofs/bradbury-persistent-proof-v1.json', import.meta.url))

function fail(message) {
  throw new Error(`Online live-proof validation failed: ${message}`)
}

function equalString(actual, expected, label) {
  if (String(actual) !== String(expected)) fail(`${label}: expected ${expected}, got ${actual ?? 'MISSING'}`)
}

function equalAddress(actual, expected, label) {
  if (typeof actual !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`${label}: expected ${expected}, got ${actual ?? 'MISSING'}`)
  }
}

async function withRetries(operation, {
  retries = 8,
  interval = 2000,
  sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
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

function completionTransactions(proof) {
  const transactions = [
    {
      label: 'deployment',
      hash: proof.deployment.transaction,
      explorer: proof.deployment.explorer,
    },
  ]
  for (const [scenarioName, scenario] of Object.entries(proof.scenarios)) {
    for (const [phase, transaction] of Object.entries(scenario.transactions ?? {})) {
      transactions.push({ label: `${scenarioName} ${phase}`, ...transaction })
    }
  }
  const unique = new Map()
  for (const transaction of transactions) unique.set(transaction.hash.toLowerCase(), transaction)
  return [...unique.values()]
}

function expectedSubmissionScenarios(proof) {
  return [
    proof.scenarios.clearRejection,
    proof.scenarios.mutationInconclusive,
    proof.scenarios.clearApprovalAndPayout,
  ]
}

export async function verifyPublicProofOnline({
  proof,
  client,
  retryOptions,
} = {}) {
  validatePublicLiveProof(proof)
  if (!client) fail('a read-only Bradbury client is required')

  const lifecycle = []
  for (const transaction of completionTransactions(proof)) {
    let receipt
    try {
      receipt = await withRetries(() => client.getTransaction({ hash: transaction.hash }), retryOptions)
    } catch (error) {
      fail(`${transaction.label} lifecycle lookup failed: ${error?.message ?? error}`)
    }
    const classification = classifyLiveReceipt(receipt)
    if (classification.phase !== 'FINALIZED') {
      fail(
        `${transaction.label} is not successful FINALIZED: ${classification.statusName || 'UNKNOWN'}/${classification.resultName || 'UNKNOWN'}/${classification.executionResultName || 'UNKNOWN'}`,
      )
    }
    lifecycle.push({
      label: transaction.label,
      hash: transaction.hash,
      explorer: transaction.explorer,
      statusName: classification.statusName,
      resultName: classification.resultName,
      executionResultName: classification.executionResultName,
    })
  }

  const submissions = []
  for (const scenario of expectedSubmissionScenarios(proof)) {
    let onChain
    try {
      onChain = await withRetries(() => client.readContract({
        address: proof.contract.address,
        functionName: 'get_submission',
        args: [scenario.submissionId],
      }), retryOptions)
    } catch (error) {
      fail(`submission ${scenario.submissionId} read failed: ${error?.message ?? error}`)
    }
    equalString(onChain.id, scenario.submissionId, 'submission ID')
    equalString(onChain.bounty_id, scenario.bountyId, 'submission bounty ID')
    equalAddress(onChain.creator, proof.accounts.creatorAndPayoutRecipient, 'submission creator')
    equalString(onChain.status, scenario.result.status, 'submission status')
    equalString(onChain.decision, scenario.result.decision, 'submission decision')
    equalString(onChain.reason_code, scenario.result.reasonCode, 'submission reason')
    equalString(onChain.evidence_sha256, scenario.result.evidenceSha256, 'submission evidence SHA-256')
    equalString(onChain.evidence_uri, scenario.evidenceUri, 'submission evidence URI')
    submissions.push({
      bountyId: scenario.bountyId,
      submissionId: scenario.submissionId,
      status: onChain.status,
      decision: onChain.decision,
      reasonCode: onChain.reason_code,
      evidenceSha256: onChain.evidence_sha256,
    })

    let bounty
    try {
      bounty = await withRetries(() => client.readContract({
        address: proof.contract.address,
        functionName: 'get_bounty',
        args: [scenario.bountyId],
      }), retryOptions)
    } catch (error) {
      fail(`bounty ${scenario.bountyId} read failed: ${error?.message ?? error}`)
    }
    equalString(bounty.id, scenario.bountyId, 'bounty ID')
    equalString(bounty.title, scenario.title, 'bounty title')
    equalAddress(bounty.poster, proof.accounts.deployer, 'bounty poster')
    equalString(bounty.reward, EXPECTED_PAYOUT_WEI, 'bounty reward')
  }

  return {
    checkedAt: new Date().toISOString(),
    network: proof.network.selector,
    contract: proof.contract,
    lifecycle,
    submissions,
    payout: proof.scenarios.clearApprovalAndPayout.payout,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const proofPath = resolve(process.argv[2] || DEFAULT_PUBLIC_PROOF)
    const proof = JSON.parse(readFileSync(proofPath, 'utf8'))
    const result = await verifyPublicProofOnline({
      proof,
      client: createClient({ chain: testnetBradbury }),
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
