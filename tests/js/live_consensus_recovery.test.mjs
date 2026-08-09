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
