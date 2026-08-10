import assert from 'node:assert/strict'
import test from 'node:test'
import { recoverExistingScenarioRecords } from '../integration/live_consensus.mjs'

const expirationHash = '0xda8b176f3671b7fe4cfd2f2b23801377285119f0267144903b619f68e3ffc8d4'

test('attaches an existing finalized expiration to the exact mutable scenario', () => {
  const proof = {
    scenarios: {
      mutationScenario: {
        scenarioKey: 'mutation',
        title: 'Live mutation inconclusive',
        evidenceUri: 'https://evidence.example/mutable.txt',
        bountyId: 1,
        submissionId: 1,
        postTransaction: '0xpost',
        submissionTransaction: '0xsubmit',
        evaluationTransaction: null,
        closureAction: null,
        closureTransaction: null,
        history: [],
      },
    },
    transactions: [{
      label: 'expire Live mutation inconclusive',
      hash: expirationHash,
      observations: [{ phase: 'FINALIZED' }],
    }],
  }
  recoverExistingScenarioRecords(proof, 'https://evidence.example/mutable.txt')
  assert.equal(proof.scenarios.mutationScenario.closureAction, 'EXPIRE')
  assert.equal(proof.scenarios.mutationScenario.closureTransaction, expirationHash)
})

test('fails closed when legacy closure-label recovery is ambiguous', () => {
  const proof = {
    scenarios: {
      mutationScenario: {
        scenarioKey: 'mutation',
        title: 'Live mutation inconclusive',
        closureTransaction: null,
      },
    },
    transactions: [1, 2].map((id) => ({
      label: 'expire Live mutation inconclusive',
      hash: `0xexpire${id}`,
      observations: [{ phase: 'FINALIZED' }],
    })),
  }
  assert.throws(
    () => recoverExistingScenarioRecords(proof, 'https://evidence.example/mutable.txt'),
    /Multiple usable transactions/,
  )
})

test('clears a historical submission transaction misattached to a replacement bounty', () => {
  const historicalSubmission = '0xf6951790e7933b6f257dbf4959d98384b05b824ea4588e6a602d5931384003be'
  const proof = {
    scenarios: {
      mutationScenario: {
        scenarioKey: 'mutation',
        title: 'Live mutation inconclusive [replacement]',
        evidenceUri: 'https://evidence.example/mutable.txt',
        bountyId: 2,
        submissionId: null,
        submissionTransaction: historicalSubmission,
        history: [{
          title: 'Live mutation inconclusive',
          bountyId: 1,
          submissionId: 1,
          submissionTransaction: historicalSubmission,
        }],
      },
    },
    transactions: [],
  }
  recoverExistingScenarioRecords(proof, 'https://evidence.example/mutable.txt')
  const scenario = proof.scenarios.mutationScenario
  assert.equal(scenario.submissionTransaction, null)
  assert.equal(scenario.history[0].submissionTransaction, historicalSubmission)
  assert.equal(scenario.recoveryCorrections.length, 1)
  assert.equal(scenario.recoveryCorrections[0].transaction, historicalSubmission)
  assert.equal(scenario.recoveryCorrections[0].historicalBountyId, 1)
  assert.equal(scenario.recoveryCorrections[0].currentBountyId, 2)
})

test('fails closed if a stored submission ID claims a historical transaction from another bounty', () => {
  const historicalSubmission = '0xf6951790e7933b6f257dbf4959d98384b05b824ea4588e6a602d5931384003be'
  const proof = {
    scenarios: {
      mutationScenario: {
        scenarioKey: 'mutation',
        title: 'Live mutation inconclusive [replacement]',
        bountyId: 2,
        submissionId: 2,
        submissionTransaction: historicalSubmission,
        history: [{ bountyId: 1, submissionTransaction: historicalSubmission }],
      },
    },
    transactions: [],
  }
  assert.throws(
    () => recoverExistingScenarioRecords(proof, 'https://evidence.example/mutable.txt'),
    /reuses a historical transaction/,
  )
})
