import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const PRIVATE_KEY_PATTERN = /0x[0-9a-fA-F]{64}/g

export function proofJson(value) {
  return JSON.stringify(
    value,
    (_key, item) => typeof item === 'bigint' ? item.toString() : item,
    2,
  )
}

export function redactProofError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(PRIVATE_KEY_PATTERN, '<redacted-secret>')
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

export function checkpointProof(output, proof) {
  const target = resolve(output)
  mkdirSync(dirname(target), { recursive: true })
  proof.updatedAt = new Date().toISOString()
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

export function recordProofFailure(output, proof, error) {
  proof.status = 'FAILED'
  proof.proofComplete = false
  proof.failure = {
    timestamp: new Date().toISOString(),
    message: redactProofError(error),
  }
  checkpointProof(output, proof)
  return proof
}
