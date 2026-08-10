import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectRunnerProvenance,
  deployedSourceProvenance,
  selectDeployedSourceProvenance,
} from '../../scripts/live-provenance.mjs'

test('records deployed source separately from runner provenance', () => {
  const source = deployedSourceProvenance('a'.repeat(64), 'c5c64c1ef007fa9b06d96aaa9255fe7322e6d356')
  const runner = collectRunnerProvenance({
    git: (args) => args[0] === 'rev-parse' ? 'runner-commit' : ' M runner.mjs',
  })
  assert.deepEqual(source, { commit: 'c5c64c1ef007fa9b06d96aaa9255fe7322e6d356', sha256: 'a'.repeat(64) })
  assert.deepEqual(runner, { commit: 'runner-commit', dirty: true })
  assert.notEqual(source.commit, runner.commit)
})

test('records a clean committed runner exactly', () => {
  const runner = collectRunnerProvenance({
    git: (args) => args[0] === 'rev-parse' ? '39c9cbc' : '',
  })
  assert.deepEqual(runner, { commit: '39c9cbc', dirty: false })
})

test('preserves deployment-time artifact commit and uses runner commit only for fresh deployment', () => {
  const common = { runnerCommit: 'current-runner', sourceSha256: 'b'.repeat(64) }
  assert.equal(selectDeployedSourceProvenance({
    ...common,
    storedProof: { sourceCommit: 'c5c64c1ef007fa9b06d96aaa9255fe7322e6d356', sourceSha256: 'b'.repeat(64) },
  }).commit, 'c5c64c1ef007fa9b06d96aaa9255fe7322e6d356')
  assert.equal(selectDeployedSourceProvenance({ ...common, storedProof: null }).commit, 'current-runner')
  assert.throws(() => selectDeployedSourceProvenance({
    ...common,
    storedProof: { sourceCommit: 'recorded', sourceSha256: 'c'.repeat(64) },
  }), /SHA-256/)
})
