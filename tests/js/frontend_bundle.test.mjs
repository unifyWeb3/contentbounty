import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
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
  assert.throws(() => verifyFrontendBundle(directory), /authoritative v2\.1\.1 address is absent/i)
})

test('bundle verification requires the authoritative address and rejects no historical address', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-bundle-'))
  writeFileSync(join(directory, 'index.js'), `const address = "${AUTHORITATIVE_V2_1_1_ADDRESS}"`)
  assert.deepEqual(verifyFrontendBundle(directory), {
    directory,
    filesScanned: 1,
    historicalAddressEmbedded: false,
    expectedAddress: AUTHORITATIVE_V2_1_1_ADDRESS,
    expectedAddressEmbedded: true,
  })
})
