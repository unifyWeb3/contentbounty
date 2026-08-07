import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PERSISTENT_PROOF_MODE,
  STUDIONET_SMOKE_PROOF_MODE,
  selectLiveProofMode,
} from '../../scripts/live-proof-mode.mjs'

test('requires an explicit network selector and proof mode', () => {
  assert.throws(() => selectLiveProofMode('', PERSISTENT_PROOF_MODE), /LIVE_GENLAYER_NETWORK is required/)
  assert.throws(() => selectLiveProofMode('testnetBradbury', ''), /LIVE_PROOF_MODE is required/)
})

test('persistent proof mode is limited to the real public testnets', () => {
  for (const network of ['testnetAsimov', 'testnetBradbury']) {
    assert.deepEqual(selectLiveProofMode(network, PERSISTENT_PROOF_MODE), {
      network,
      mode: PERSISTENT_PROOF_MODE,
      persistent: true,
      balancesSimulated: false,
      persistentPayoutProofEligible: true,
    })
  }
  assert.throws(
    () => selectLiveProofMode('studionet', PERSISTENT_PROOF_MODE),
    /Studionet is available only as LIVE_PROOF_MODE=studionet-smoke/,
  )
})

test('Studionet smoke mode is explicit and never payout-proof eligible', () => {
  assert.deepEqual(selectLiveProofMode('studionet', STUDIONET_SMOKE_PROOF_MODE), {
    network: 'studionet',
    mode: STUDIONET_SMOKE_PROOF_MODE,
    persistent: false,
    balancesSimulated: true,
    persistentPayoutProofEligible: false,
  })
  assert.throws(
    () => selectLiveProofMode('testnetBradbury', STUDIONET_SMOKE_PROOF_MODE),
    /requires LIVE_PROOF_MODE=persistent/,
  )
})

test('unsupported selectors fail closed', () => {
  assert.throws(
    () => selectLiveProofMode('localnet', PERSISTENT_PROOF_MODE),
    /Unsupported live proof network/,
  )
})
