import assert from 'node:assert/strict'
import test from 'node:test'
import { studionet, testnetBradbury } from 'genlayer-js/chains'
import {
  selectDeploymentMode,
  selectGenLayerNetwork,
} from '../../scripts/genlayer-network.mjs'

test('deployment network selection returns complete official chain objects', () => {
  assert.deepEqual(selectGenLayerNetwork(), { name: 'testnetBradbury', chain: testnetBradbury })
  assert.deepEqual(selectGenLayerNetwork('testnetBradbury'), { name: 'testnetBradbury', chain: testnetBradbury })
})

test('deployment network selection rejects unsupported values', () => {
  assert.throws(() => selectGenLayerNetwork('localnet'), /Unsupported GenLayer network/)
  assert.throws(() => selectGenLayerNetwork('Studionet'), /Unsupported GenLayer network/)
  assert.throws(() => selectGenLayerNetwork('testnetAsimov'), /Unsupported GenLayer network/)
})

test('Bradbury selection retains the complete official RPC and consensus configuration', () => {
  const selected = selectGenLayerNetwork('testnetBradbury')
  assert.equal(selected.chain.id, 4221)
  assert.equal(selected.chain.rpcUrls.default.http[0], 'https://rpc-bradbury.genlayer.com')
  assert.equal(selected.chain.consensusMainContract.address, '0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D')
})

test('deployment modes keep Bradbury persistent and Studionet explicitly simulated', () => {
  assert.deepEqual(selectDeploymentMode('testnetBradbury', 'persistent'), {
    mode: 'persistent',
    persistent: true,
    balancesSimulated: false,
  })
  assert.deepEqual(selectDeploymentMode('studionet', 'studionet-smoke'), {
    mode: 'studionet-smoke',
    persistent: false,
    balancesSimulated: true,
  })
  assert.throws(() => selectDeploymentMode('studionet', 'persistent'), /not valid/)
  assert.throws(() => selectDeploymentMode('testnetBradbury', 'studionet-smoke'), /not valid/)
  assert.throws(() => selectDeploymentMode('testnetBradbury', ''), /GENLAYER_DEPLOY_MODE is required/)
})
