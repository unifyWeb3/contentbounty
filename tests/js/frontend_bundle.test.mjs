import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AUTHORITATIVE_ADDRESS,
  AUTHORITATIVE_V2_1_1_ADDRESS,
  verifyFrontendBundle,
} from '../../scripts/verify_frontend_bundle.mjs'

test('bundle verification rejects the historical v0.2 address', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-bundle-'))
  writeFileSync(
    join(directory, 'index.js'),
    'const address = "0xFf546d6B1CD45d2859a705a7FA181807670B9015"',
  )
  assert.throws(() => verifyFrontendBundle(directory), /historical v0.2 address embedded/i)
})

test('bundle verification rejects a production bundle missing the authoritative address', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-bundle-'))
  writeFileSync(join(directory, 'index.js'), 'const address = ""')
  assert.throws(() => verifyFrontendBundle(directory), /authoritative address is absent/i)
})

test('bundle verification requires the authoritative address and rejects no historical address', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-bundle-'))
  writeFileSync(join(directory, 'index.js'), `const address = "${AUTHORITATIVE_ADDRESS}"`)
  assert.deepEqual(verifyFrontendBundle(directory), {
    directory,
    filesScanned: 1,
    historicalAddressEmbedded: false,
    expectedAddress: AUTHORITATIVE_ADDRESS,
    expectedAddressEmbedded: true,
  })
})

test('historical v2.1.1 address is not required for v2.2 bundle', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-bundle-'))
  writeFileSync(join(directory, 'index.js'), `const address = "${AUTHORITATIVE_ADDRESS}"`)
  // v2.1.1 address should not be required; explicit check still works when passed
  assert.deepEqual(verifyFrontendBundle(directory, { expectedAddress: AUTHORITATIVE_V2_1_1_ADDRESS }), {
    directory,
    filesScanned: 1,
    historicalAddressEmbedded: false,
    expectedAddress: AUTHORITATIVE_V2_1_1_ADDRESS,
    expectedAddressEmbedded: false,
  })
  // New address must be present by default
  assert.ok(verifyFrontendBundle(directory).expectedAddressEmbedded)
})
