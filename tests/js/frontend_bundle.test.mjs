import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyFrontendBundle } from '../../scripts/verify_frontend_bundle.mjs'

test('bundle verification rejects the historical v0.2 address', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-bundle-'))
  writeFileSync(
    join(directory, 'index.js'),
    'const address = "0xFf546d6B1CD45d2859a705a7FA181807670B9015"',
  )
  assert.throws(() => verifyFrontendBundle(directory), /historical v0.2 address embedded/i)
})

test('bundle verification accepts a configured-free production bundle', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contentbounty-bundle-'))
  writeFileSync(join(directory, 'index.js'), 'const address = ""')
  assert.deepEqual(verifyFrontendBundle(directory), {
    directory,
    filesScanned: 1,
    historicalAddressEmbedded: false,
  })
})
