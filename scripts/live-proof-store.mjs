import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const PRIVATE_KEY_PATTERN = /0x[0-9a-fA-F]{64}/g
const URL_QUERY_PATTERN = /(https:\/\/[^\s?'"<>]+)\?[^\s'"<>]*/g

export function proofJson(value) {
  return JSON.stringify(
    value,
    (_key, item) => typeof item === 'bigint' ? item.toString() : item,
    2,
  )
}

export function redactProofError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(PRIVATE_KEY_PATTERN, '<redacted-secret>')
    .replace(URL_QUERY_PATTERN, '$1?<redacted-query>')
}

export function updateProofCompletion(proof) {
  const checks = proof.completionChecks ?? {}
  proof.proofComplete = Boolean(
    proof.persistent
    && proof.persistentPayoutProofEligible
    && checks.deploymentFinalized
    && checks.clearRejection
    && checks.adversarialRejectionVerified
    && checks.mutationInconclusive
    && checks.clearApprovalFinalized
    && checks.persistentPayoutDelta,
  )
  return proof.proofComplete
}

export function checkpointProof(output, proof, now = () => new Date().toISOString()) {
  const target = resolve(output)
  mkdirSync(dirname(target), { recursive: true })
  const candidateUpdatedAt = now()
  proof.updatedAt = proof.failure?.timestamp && proof.failure.timestamp > candidateUpdatedAt
    ? proof.failure.timestamp
    : candidateUpdatedAt
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${proofJson(proof)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, target)
  chmodSync(target, 0o600)
  return proof
}

export function createProofArtifact(output, initialProof) {
  const proof = {
    status: 'RUNNING',
    proofComplete: false,
    failure: null,
    completionChecks: {
      deploymentFinalized: false,
      clearRejection: false,
      adversarialRejectionVerified: false,
      mutationInconclusive: false,
      clearApprovalFinalized: false,
      persistentPayoutDelta: false,
    },
    ...initialProof,
  }
  updateProofCompletion(proof)
  checkpointProof(output, proof)
  return proof
}

export function loadProofArtifact(output) {
  try {
    return normalizeProofTransactions(JSON.parse(readFileSync(resolve(output), 'utf8')))
  } catch {
    return null
  }
}

export function normalizeTransactionConvenienceFields(transactionProof) {
  transactionProof.observations ??= []
  transactionProof.accepted = transactionProof.observations.find((item) => item.phase === 'ACCEPTED') ?? null
  transactionProof.finalized = transactionProof.observations.find((item) => item.phase === 'FINALIZED') ?? null
  transactionProof.acceptedPhaseObserved = Boolean(transactionProof.accepted)
  transactionProof.successfulFinalizationObserved = Boolean(transactionProof.finalized)
  transactionProof.separateAcceptedAndFinalizedObservations = Boolean(
    transactionProof.accepted && transactionProof.finalized,
  )
  return transactionProof
}

export function normalizeProofTransactions(proof) {
  if (!proof || typeof proof !== 'object') return proof
  proof.transactions ??= []
  for (const transaction of proof.transactions) normalizeTransactionConvenienceFields(transaction)
  return proof
}

export function resumeProofArtifact(proof, now = () => new Date().toISOString()) {
  normalizeProofTransactions(proof)
  proof.status = 'RUNNING'
  proof.proofComplete = false
  proof.failure = null
  proof.resumedAt = now()
  return proof
}

export function recordTransactionObservation(transactionProof, observation) {
  transactionProof.observations ??= []
  transactionProof.observations.push(observation)
  return normalizeTransactionConvenienceFields(transactionProof)
}

export function recordProofFailure(output, proof, error, now = () => new Date().toISOString()) {
  proof.status = 'FAILED'
  proof.proofComplete = false
  proof.failure = {
    timestamp: now(),
    message: redactProofError(error),
  }
  checkpointProof(output, proof, now)
  return proof
}

export function recordProofExternalBlocker(output, proof, error, now = () => new Date().toISOString()) {
  proof.status = 'BLOCKED_EXTERNAL_RPC'
  proof.proofComplete = false
  proof.failure = {
    timestamp: now(),
    message: redactProofError(error),
  }
  checkpointProof(output, proof, now)
  return proof
}
