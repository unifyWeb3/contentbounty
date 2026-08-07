import assert from 'node:assert/strict'
import test from 'node:test'
import { studionet, testnetAsimov, testnetBradbury } from 'genlayer-js/chains'
import { selectGenLayerNetwork } from '../../scripts/genlayer-network.mjs'

test('deployment network selection returns complete official chain objects', () => {
  assert.deepEqual(selectGenLayerNetwork(), { name: 'studionet', chain: studionet })
  assert.deepEqual(selectGenLayerNetwork('testnetAsimov'), { name: 'testnetAsimov', chain: testnetAsimov })
  assert.deepEqual(selectGenLayerNetwork('testnetBradbury'), { name: 'testnetBradbury', chain: testnetBradbury })
})

test('deployment network selection rejects unsupported values', () => {
  assert.throws(() => selectGenLayerNetwork('localnet'), /Unsupported GenLayer network/)
  assert.throws(() => selectGenLayerNetwork('Studionet'), /Unsupported GenLayer network/)
})

test('same-ID testnets retain distinct RPC and consensus configurations', () => {
  assert.equal(testnetAsimov.id, testnetBradbury.id)
  assert.notEqual(testnetAsimov.rpcUrls.default.http[0], testnetBradbury.rpcUrls.default.http[0])
  assert.notEqual(testnetAsimov.consensusMainContract.address, testnetBradbury.consensusMainContract.address)
})
