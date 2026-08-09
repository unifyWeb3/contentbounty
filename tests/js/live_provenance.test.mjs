import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectRunnerProvenance,
  DEPLOYED_SOURCE_COMMIT,
  deployedSourceProvenance,
  selectDeployedSourceProvenance,
} from '../../scripts/live-provenance.mjs'

test('records deployed source separately from runner provenance', () => {
  const source = deployedSourceProvenance('a'.repeat(64))
  const runner = collectRunnerProvenance({
    git: (args) => args[0] === 'rev-parse' ? 'runner-commit' : ' M runner.mjs',
  })
  assert.deepEqual(source, { commit: DEPLOYED_SOURCE_COMMIT, sha256: 'a'.repeat(64) })
  assert.deepEqual(runner, { commit: 'runner-commit', dirty: true })
  assert.notEqual(source.commit, runner.commit)
})

test('records a clean committed runner exactly', () => {
  const runner = collectRunnerProvenance({
    git: (args) => args[0] === 'rev-parse' ? '39c9cbc' : '',
  })
  assert.deepEqual(runner, { commit: '39c9cbc', dirty: false })
})

test('uses historical source commit only for recovery and current runner for fresh deployment', () => {
  const common = { runnerCommit: 'current-runner', sourceSha256: 'b'.repeat(64) }
  assert.equal(selectDeployedSourceProvenance({ ...common, recovery: {} }).commit, DEPLOYED_SOURCE_COMMIT)
  assert.equal(selectDeployedSourceProvenance({ ...common, recovery: null }).commit, 'current-runner')
})
