import { execFileSync } from 'node:child_process'

export const DEPLOYED_SOURCE_COMMIT = 'f29acfcf7eacace94eaa1f4601abf832f60e6898'

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

export function collectRunnerProvenance({ git = gitValue } = {}) {
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0,
  }
}

export function deployedSourceProvenance(sourceSha256, commit = DEPLOYED_SOURCE_COMMIT) {
  return { commit, sha256: sourceSha256 }
}

export function selectDeployedSourceProvenance({ recovery, runnerCommit, sourceSha256 }) {
  return deployedSourceProvenance(
    sourceSha256,
    recovery ? DEPLOYED_SOURCE_COMMIT : runnerCommit,
  )
}
