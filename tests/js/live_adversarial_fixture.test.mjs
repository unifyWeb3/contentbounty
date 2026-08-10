import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyOnChainAdversarialCommitment,
  loadCommittedLiveAdversarialFixture,
  normalizeLiveEvidence,
  verifyLiveAdversarialFixture,
} from '../../scripts/live-adversarial-fixture.mjs'

test('committed live adversarial fixture matches its canonical manifest', () => {
  assert.deepEqual(loadCommittedLiveAdversarialFixture(), {
    fixtureVersion: 'content-bounty-live-adversarial-rejection-v1',
    fixtureName: 'adversarial_rejection_v1',
    expectedNormalizedSha256: 'efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537',
    characterCount: 1092,
    utf8ByteCount: 1092,
    description: 'Canonical rejection evidence that clearly fails the live rubric while carrying representative structured prompt-injection attacks.',
    adversarialCases: [
      'closing-tag injection',
      'ignore-previous-instructions attack',
      'fake JSON and output-format instructions',
      'system, developer, and assistant role impersonation',
      'injection propagated through an extracted-observation-shaped payload',
      'malicious rubric override text',
    ],
  })
})

test('fixture verification rejects mutated hosted content', () => {
  const content = normalizeLiveEvidence('adversarial fixture')
  assert.throws(
    () => verifyLiveAdversarialFixture({
      fixture_version: 'v1',
      fixture_name: 'fixture',
      format: 'content-bounty-text-v1',
      expected_normalized_sha256: '0'.repeat(64),
      character_count: content.length,
      utf8_byte_count: content.length,
    }, content),
    /SHA-256 mismatch/,
  )
})

test('on-chain commitment classification requires the exact committed digest', () => {
  const fixture = loadCommittedLiveAdversarialFixture()
  assert.equal(classifyOnChainAdversarialCommitment(
    fixture,
    fixture.expectedNormalizedSha256.toUpperCase(),
  ).verified, true)
  assert.deepEqual(classifyOnChainAdversarialCommitment(fixture, '0'.repeat(64)), {
    fixtureVersion: fixture.fixtureVersion,
    fixtureName: fixture.fixtureName,
    expectedNormalizedSha256: fixture.expectedNormalizedSha256,
    observedOnChainSha256: '0'.repeat(64),
    verified: false,
  })
})
