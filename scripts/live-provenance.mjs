import { execFileSync } from 'node:child_process'

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

export function collectRunnerProvenance({ git = gitValue } = {}) {
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0,
  }
}

export function deployedSourceProvenance(sourceSha256, commit) {
  if (typeof commit !== 'string' || !commit.trim()) {
    throw new Error('Deployed source commit provenance is missing')
  }
  return { commit, sha256: sourceSha256 }
}

export function selectDeployedSourceProvenance({ storedProof, runnerCommit, sourceSha256 }) {
  const recordedCommit = storedProof?.deployedSource?.commit ?? storedProof?.sourceCommit
  const recordedSha256 = storedProof?.deployedSource?.sha256 ?? storedProof?.sourceSha256
  if (recordedCommit) {
    if (recordedSha256?.toLowerCase() !== sourceSha256.toLowerCase()) {
      throw new Error('Stored deployed-source SHA-256 does not match the current contract source')
    }
    return deployedSourceProvenance(sourceSha256, recordedCommit)
  }
  return deployedSourceProvenance(sourceSha256, runnerCommit)
}
