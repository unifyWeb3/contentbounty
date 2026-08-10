import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  recoverFinalizedDeployment,
  validateRecoveryProofArtifact,
} from '../../scripts/live-deployment-recovery.mjs'

const source = 'print("v2")\n'
const sourceSha256 = createHash('sha256').update(source).digest('hex')
const txId = `0x${'a'.repeat(64)}`
const address = `0x${'b'.repeat(40)}`
const successful = {
  statusName: 'FINALIZED',
  resultName: 'AGREE',
  txExecutionResultName: 'FINISHED_WITH_RETURN',
  txDataDecoded: { type: 'deploy', code: source, contractAddress: address },
}

function clientWith(transaction = successful) {
  return { getTransaction: async ({ hash }) => { assert.equal(hash, txId); return transaction } }
}

test('recovers a finalized Bradbury deployment and verifies source/address', async () => {
  const result = await recoverFinalizedDeployment({
    client: clientWith(), deploymentTransaction: txId, contractAddress: address, expectedSourceSha256: sourceSha256,
  })
  assert.equal(result.contractAddress, address)
  assert.equal(result.sourceSha256, sourceSha256)
  assert.deepEqual(result.lifecycle, {
    statusName: 'FINALIZED', resultName: 'AGREE', executionResultName: 'FINISHED_WITH_RETURN', phase: 'FINALIZED',
  })
})

for (const [label, transaction, expected] of [
  ['non-finalized', { ...successful, statusName: 'ACCEPTED' }, /not FINALIZED/],
  ['disagreement', { ...successful, resultName: 'DISAGREE' }, /not AGREE/],
  ['execution error', { ...successful, txExecutionResultName: 'FINISHED_WITH_ERROR' }, /did not finish with return/],
  ['wrong address', { ...successful, txDataDecoded: { ...successful.txDataDecoded, contractAddress: `0x${'c'.repeat(40)}` } }, /address mismatch/],
  ['wrong source', successful, /source SHA-256 mismatch/],
  ['not deployment', { ...successful, txDataDecoded: { type: 'call', code: source, contractAddress: address } }, /not a deployment/],
]) {
  test(`fails closed for ${label}`, async () => {
    await assert.rejects(
      recoverFinalizedDeployment({
        client: clientWith(transaction), deploymentTransaction: txId, contractAddress: address,
        expectedSourceSha256: label === 'wrong source' ? '0'.repeat(64) : sourceSha256,
      }), expected,
    )
  })
}

test('rejects malformed recovery inputs before the lookup', async () => {
  let calls = 0
  const client = { getTransaction: async () => { calls += 1; return successful } }
  await assert.rejects(recoverFinalizedDeployment({ client, deploymentTransaction: '0x1', contractAddress: address, expectedSourceSha256: sourceSha256 }), /transaction/i)
  await assert.rejects(recoverFinalizedDeployment({ client, deploymentTransaction: txId, contractAddress: '0x1', expectedSourceSha256: sourceSha256 }), /address/i)
  await assert.rejects(recoverFinalizedDeployment({ client, deploymentTransaction: txId, contractAddress: address, expectedSourceSha256: 'bad' }), /SHA-256/i)
  assert.equal(calls, 0)
})

test('accepts numeric consensus-data fields from the official Bradbury ABI', async () => {
  const result = await recoverFinalizedDeployment({
    client: clientWith({
      status: 7,
      result: 1,
      txExecutionResult: 1,
      txDataDecoded: successful.txDataDecoded,
    }),
    deploymentTransaction: txId,
    contractAddress: address,
    expectedSourceSha256: sourceSha256,
  })
  assert.equal(result.lifecycle.statusName, 'FINALIZED')
  assert.equal(result.lifecycle.resultName, 'AGREE')
  assert.equal(result.lifecycle.executionResultName, 'FINISHED_WITH_RETURN')
})

test('retries transient consensus-data lookup failures', async () => {
  let calls = 0
  const result = await recoverFinalizedDeployment({
    client: {
      getTransaction: async () => {
        calls += 1
        if (calls < 3) throw new Error('fetch failed')
        return successful
      },
    },
    deploymentTransaction: txId,
    contractAddress: address,
    expectedSourceSha256: sourceSha256,
    transientRetries: 2,
    transientRetryInterval: 0,
    sleep: async () => {},
  })
  assert.equal(result.lifecycle.phase, 'FINALIZED')
  assert.equal(calls, 3)
})

test('validates a resumable proof artifact and rejects identity mismatches', () => {
  const input = {
    network: 'testnetBradbury',
    deploymentTransaction: txId,
    contractAddress: address,
    sourceSha256,
    deployer: `0x${'d'.repeat(40)}`,
    creator: `0x${'e'.repeat(40)}`,
  }
  const proof = {
    network: input.network,
    sourceSha256,
    deployer: input.deployer,
    creator: input.creator,
    contractAddress: address,
    recoveredDeployment: { transaction: txId },
  }
  assert.equal(validateRecoveryProofArtifact(proof, input), proof)
  assert.throws(() => validateRecoveryProofArtifact({ ...proof, contractAddress: `0x${'f'.repeat(40)}` }, input), /contract address mismatch/)
  assert.throws(() => validateRecoveryProofArtifact({ ...proof, deployer: input.creator }, input), /deployer account mismatch/)
})
