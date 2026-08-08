import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))
export const LIVE_ADVERSARIAL_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  'tests/fixtures/live/adversarial_rejection_v1.json',
)

export function normalizeLiveEvidence(content) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

export function verifyLiveAdversarialFixture(manifest, content) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Adversarial fixture manifest is invalid')
  if (manifest.format !== 'content-bounty-text-v1') throw new Error('Adversarial fixture format is unsupported')
  if (typeof manifest.fixture_version !== 'string' || !manifest.fixture_version.trim()) {
    throw new Error('Adversarial fixture version is missing')
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.expected_normalized_sha256)) {
    throw new Error('Adversarial fixture expected SHA-256 is invalid')
  }
  const normalized = normalizeLiveEvidence(content)
  const observedHash = createHash('sha256').update(normalized, 'utf8').digest('hex')
  const characterCount = normalized.length
  const utf8ByteCount = Buffer.byteLength(normalized, 'utf8')
  if (observedHash !== manifest.expected_normalized_sha256) {
    throw new Error(
      `Committed adversarial fixture SHA-256 mismatch: expected ${manifest.expected_normalized_sha256}, got ${observedHash}`,
    )
  }
  if (characterCount !== manifest.character_count) {
    throw new Error(
      `Committed adversarial fixture character-count mismatch: expected ${manifest.character_count}, got ${characterCount}`,
    )
  }
  if (utf8ByteCount !== manifest.utf8_byte_count) {
    throw new Error(
      `Committed adversarial fixture byte-count mismatch: expected ${manifest.utf8_byte_count}, got ${utf8ByteCount}`,
    )
  }
  return {
    fixtureVersion: manifest.fixture_version,
    fixtureName: manifest.fixture_name,
    expectedNormalizedSha256: manifest.expected_normalized_sha256,
    characterCount,
    utf8ByteCount,
    description: manifest.description,
    adversarialCases: manifest.adversarial_cases,
  }
}

export function loadCommittedLiveAdversarialFixture() {
  const manifest = JSON.parse(readFileSync(LIVE_ADVERSARIAL_MANIFEST_PATH, 'utf8'))
  const textPath = resolve(REPOSITORY_ROOT, manifest.text_path)
  const content = readFileSync(textPath, 'utf8')
  return verifyLiveAdversarialFixture(manifest, content)
}

export function classifyOnChainAdversarialCommitment(fixture, observedHash) {
  const observedOnChainSha256 = typeof observedHash === 'string'
    ? observedHash.trim().toLowerCase()
    : ''
  return {
    fixtureVersion: fixture.fixtureVersion,
    fixtureName: fixture.fixtureName,
    expectedNormalizedSha256: fixture.expectedNormalizedSha256,
    observedOnChainSha256,
    verified: observedOnChainSha256 === fixture.expectedNormalizedSha256,
  }
}
