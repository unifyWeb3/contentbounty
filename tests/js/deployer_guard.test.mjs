import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  guardedDeploymentAccount,
  main as deployMain,
  successfulDeploymentSummary,
} from '../../deploy.mjs'
import {
  assertSafeDeployerAccount,
  COMPROMISED_DEPLOYER_ADDRESSES,
} from '../../scripts/deployer-guard.mjs'

test('both compromised deployers are rejected before deployment or signing activity', () => {
  for (const address of COMPROMISED_DEPLOYER_ADDRESSES) {
    let signingCalls = 0
    assert.throws(() => {
      const account = assertSafeDeployerAccount({ address })
      signingCalls += 1
      return account
    }, /compromised account/)
    assert.equal(signingCalls, 0)
  }
})

test('deployment finality accepts Bradbury AGREE and SDK MAJORITY_AGREE', () => {
  const base = { statusName: 'FINALIZED', executionResultName: 'FINISHED_WITH_RETURN' }
  assert.equal(successfulDeploymentSummary({ ...base, resultName: 'AGREE' }), true)
  assert.equal(successfulDeploymentSummary({ ...base, resultName: 'MAJORITY_AGREE' }), true)
  assert.equal(successfulDeploymentSummary({ ...base, resultName: 'DISAGREE' }), false)
})

test('deploy.mjs rejects both compromised accounts before client creation or deployContract', async () => {
  const original = {
    network: process.env.GENLAYER_NETWORK,
    mode: process.env.GENLAYER_DEPLOY_MODE,
    key: process.env.GENLAYER_DEPLOYER_PRIVATE_KEY,
  }
  process.env.GENLAYER_NETWORK = 'testnetBradbury'
  process.env.GENLAYER_DEPLOY_MODE = 'persistent'
  process.env.GENLAYER_DEPLOYER_PRIVATE_KEY = `0x${'1'.repeat(64)}`
  for (const address of COMPROMISED_DEPLOYER_ADDRESSES) {
    let clientCalls = 0
    let deployCalls = 0
    await assert.rejects(
      deployMain({
        createAccountImpl: () => ({ address }),
        createClientImpl: () => {
          clientCalls += 1
          return { deployContract: async () => { deployCalls += 1 } }
        },
      }),
      /compromised account/,
    )
    assert.equal(clientCalls, 0)
    assert.equal(deployCalls, 0)
  }
  if (original.network === undefined) delete process.env.GENLAYER_NETWORK
  else process.env.GENLAYER_NETWORK = original.network
  if (original.mode === undefined) delete process.env.GENLAYER_DEPLOY_MODE
  else process.env.GENLAYER_DEPLOY_MODE = original.mode
  if (original.key === undefined) delete process.env.GENLAYER_DEPLOYER_PRIVATE_KEY
  else process.env.GENLAYER_DEPLOYER_PRIVATE_KEY = original.key
  const source = readFileSync('deploy.mjs', 'utf8')
  assert.ok(source.indexOf('guardedDeploymentAccount(privateKey') < source.indexOf('createClientImpl({ chain })'))
  assert.ok(source.indexOf('createClientImpl({ chain })') < source.indexOf('client.deployContract'))
})
