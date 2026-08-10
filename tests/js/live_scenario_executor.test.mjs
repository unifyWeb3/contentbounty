import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureScenarioBounty,
  ensureScenarioClosure,
  ensureScenarioEvaluation,
  ensureScenarioSubmission,
} from '../../scripts/live-scenario-executor.mjs'
import { createScenarioRecord } from '../../scripts/live-scenario-recovery.mjs'

const poster = '0x0000000000000000000000000000000000000001'
const creator = '0x0000000000000000000000000000000000000002'

function scenario(scenarioKey) {
  return createScenarioRecord({
    scenarioKey,
    baseTitle: scenarioKey === 'mutation' ? 'Live mutation inconclusive' : 'Live clear approval and payout',
    evidenceUri: `https://evidence.example/${scenarioKey}.txt`,
    generatedAt: '2026-08-09T12:00:00Z',
  })
}

for (const scenarioKey of ['mutation', 'clear-approval']) {
  test(`${scenarioKey} checkpoints before post and recovers a crash after post submission`, async () => {
    const checkpoints = []
    let postCalls = 0
    let bounties = []
    const transaction = { hash: `0xpost-${scenarioKey}`, label: `post ${scenarioKey}` }
    const first = await ensureScenarioBounty({
      scenario: scenario(scenarioKey),
      listBounties: async () => bounties,
      poster,
      findTransaction: () => null,
      submitPost: async () => { postCalls += 1; return transaction },
      waitTransaction: async () => { bounties = [{ id: 7, title: scenario(scenarioKey).title, poster }] },
      checkpointScenario: (value) => checkpoints.push(structuredClone(value)),
    })
    assert.equal(postCalls, 1)
    assert.equal(checkpoints[0].bountyId, null)
    assert.equal(checkpoints[1].postTransaction, transaction.hash)
    assert.equal(checkpoints.at(-1).bountyId, 7)

    let recoveryPostCalls = 0
    const recovered = await ensureScenarioBounty({
      scenario: { ...scenario(scenarioKey), postTransaction: transaction.hash },
      listBounties: async () => [{ id: 7, title: scenario(scenarioKey).title, poster }],
      poster,
      findTransaction: (hash) => hash === transaction.hash ? transaction : null,
      submitPost: async () => { recoveryPostCalls += 1; return transaction },
      waitTransaction: async (value) => assert.equal(value.hash, transaction.hash),
      checkpointScenario: () => {},
    })
    assert.equal(recoveryPostCalls, 0)
    assert.equal(recovered.bountyId, 7)
  })

  test(`${scenarioKey} recovers exact title plus stored post transaction before another post`, async () => {
    let postCalls = 0
    const record = scenario(scenarioKey)
    const recovered = await ensureScenarioBounty({
      scenario: record,
      listBounties: async () => [{ id: 9, title: record.title, poster }],
      poster,
      findTransaction: () => null,
      findStoredTransaction: () => ({ hash: `0xexisting-post-${scenarioKey}` }),
      submitPost: async () => { postCalls += 1 },
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    })
    assert.equal(postCalls, 0)
    assert.equal(recovered.bountyId, 9)
    assert.match(recovered.postTransaction, /existing-post/)
  })

  test(`${scenarioKey} refuses an exact bounty without an unambiguous stored post transaction`, async () => {
    const record = scenario(scenarioKey)
    let postCalls = 0
    await assert.rejects(ensureScenarioBounty({
      scenario: record,
      listBounties: async () => [{ id: 9, title: record.title, poster }],
      poster,
      findTransaction: () => null,
      findStoredTransaction: () => null,
      submitPost: async () => { postCalls += 1; return { hash: '0xmust-not-submit' } },
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    }), /no stored post transaction/)
    assert.equal(postCalls, 0)
  })

  test(`${scenarioKey} fails closed when transaction-label recovery is ambiguous`, async () => {
    const record = scenario(scenarioKey)
    await assert.rejects(ensureScenarioBounty({
      scenario: record,
      listBounties: async () => [{ id: 9, title: record.title, poster }],
      poster,
      findTransaction: () => null,
      findStoredTransaction: () => { throw new Error('Multiple usable transactions match recovery label') },
      submitPost: async () => ({ hash: '0xmust-not-submit' }),
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    }), /Multiple usable transactions/)
  })

  test(`${scenarioKey} checkpoints submission hash and recovers exact submission without resubmitting`, async () => {
    const base = { ...scenario(scenarioKey), bountyId: 12, postTransaction: `0xpost-${scenarioKey}` }
    const checkpoints = []
    let submitCalls = 0
    let submissions = []
    const transaction = { hash: `0xsubmit-${scenarioKey}`, label: `submit ${scenarioKey}` }
    const first = await ensureScenarioSubmission({
      scenario: base,
      listSubmissions: async () => submissions,
      creator,
      findTransaction: () => null,
      submitContent: async () => { submitCalls += 1; return transaction },
      waitTransaction: async () => {
        submissions = [{ id: 15, bounty_id: 12, creator, evidence_uri: base.evidenceUri }]
      },
      checkpointScenario: (value) => checkpoints.push(structuredClone(value)),
    })
    assert.equal(submitCalls, 1)
    assert.equal(checkpoints[0].submissionId, null)
    assert.equal(checkpoints[1].submissionTransaction, transaction.hash)
    assert.equal(checkpoints.at(-1).submissionId, 15)

    let recoverySubmitCalls = 0
    const recovered = await ensureScenarioSubmission({
      scenario: { ...base, submissionTransaction: transaction.hash },
      listSubmissions: async () => [{ id: 15, bounty_id: 12, creator, evidence_uri: base.evidenceUri }],
      creator,
      findTransaction: (hash) => hash === transaction.hash ? transaction : null,
      submitContent: async () => { recoverySubmitCalls += 1 },
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    })
    assert.equal(recoverySubmitCalls, 0)
    assert.equal(recovered.submissionId, 15)
  })

  test(`${scenarioKey} never adopts a label-only submission transaction from another scenario`, async () => {
    const base = { ...scenario(scenarioKey), bountyId: 12, postTransaction: `0xpost-${scenarioKey}` }
    let submitCalls = 0
    const submitted = await ensureScenarioSubmission({
      scenario: base,
      listSubmissions: async () => [],
      creator,
      findTransaction: () => null,
      findStoredTransaction: () => ({ hash: '0xhistorical-label-match' }),
      submitContent: async () => {
        submitCalls += 1
        return { hash: `0xcurrent-submit-${scenarioKey}` }
      },
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    }).catch((error) => {
      assert.match(error.message, /was not found exactly/)
      return null
    })
    assert.equal(submitted, null)
    assert.equal(submitCalls, 1)

    await assert.rejects(ensureScenarioSubmission({
      scenario: base,
      listSubmissions: async () => [{
        id: 15,
        bounty_id: 12,
        creator,
        evidence_uri: base.evidenceUri,
      }],
      creator,
      findTransaction: () => null,
      findStoredTransaction: () => ({ hash: '0xhistorical-label-match' }),
      submitContent: async () => ({ hash: '0xmust-not-submit' }),
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    }), /no stored transaction/)
  })

  test(`${scenarioKey} refuses stored IDs without exact transaction checkpoints`, async () => {
    const record = { ...scenario(scenarioKey), bountyId: 12, submissionId: 15 }
    await assert.rejects(ensureScenarioBounty({
      scenario: { ...record, submissionId: null },
      listBounties: async () => [],
      poster,
      findTransaction: () => null,
      submitPost: async () => ({ hash: '0xmust-not-post' }),
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    }), /no post transaction/)
    await assert.rejects(ensureScenarioSubmission({
      scenario: record,
      listSubmissions: async () => [],
      creator,
      findTransaction: () => null,
      submitContent: async () => ({ hash: '0xmust-not-submit' }),
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    }), /no submission transaction/)
  })

  test(`${scenarioKey} binds evaluation recovery to its stored transaction`, async () => {
    const record = {
      ...scenario(scenarioKey),
      bountyId: 20,
      submissionId: 21,
      evaluationTransaction: `0xevaluate-${scenarioKey}`,
    }
    let evaluationCalls = 0
    const result = await ensureScenarioEvaluation({
      scenario: record,
      findTransaction: (hash) => hash === record.evaluationTransaction
        ? { hash, label: `evaluate ${scenarioKey}` }
        : null,
      waitTransaction: async (transaction) => assert.equal(transaction.hash, record.evaluationTransaction),
      submitEvaluation: async () => { evaluationCalls += 1 },
      readSubmission: async () => ({ id: 21, status: 'INCONCLUSIVE' }),
      checkpointScenario: () => {},
    })
    assert.equal(evaluationCalls, 0)
    assert.equal(result.scenario.evaluationTransaction, record.evaluationTransaction)
    assert.equal(result.submission.id, 21)
  })

  test(`${scenarioKey} checkpoints evaluation transaction before waiting`, async () => {
    const record = { ...scenario(scenarioKey), bountyId: 30, submissionId: 31 }
    const checkpoints = []
    const transaction = { hash: `0xevaluate-new-${scenarioKey}` }
    const result = await ensureScenarioEvaluation({
      scenario: record,
      findTransaction: () => null,
      submitEvaluation: async () => transaction,
      waitTransaction: async () => {},
      readSubmission: async () => ({ id: 31, status: 'APPROVED' }),
      checkpointScenario: (value) => checkpoints.push(structuredClone(value)),
    })
    assert.equal(checkpoints[0].evaluationTransaction, null)
    assert.equal(checkpoints[1].evaluationTransaction, transaction.hash)
    assert.equal(result.scenario.evaluationTransaction, transaction.hash)
  })

  test(`${scenarioKey} checkpoints and resumes the exact closure transaction`, async () => {
    const record = { ...scenario(scenarioKey), bountyId: 40, submissionId: 41 }
    const checkpoints = []
    let closureCalls = 0
    const transaction = { hash: `0xclose-${scenarioKey}` }
    const closed = await ensureScenarioClosure({
      scenario: record,
      action: 'EXPIRE',
      findTransaction: () => null,
      findStoredTransaction: () => null,
      submitClosure: async () => { closureCalls += 1; return transaction },
      waitTransaction: async () => {},
      checkpointScenario: (value) => checkpoints.push(structuredClone(value)),
    })
    assert.equal(closureCalls, 1)
    assert.equal(checkpoints[0].closureTransaction, null)
    assert.equal(checkpoints[1].closureTransaction, transaction.hash)

    const resumed = await ensureScenarioClosure({
      scenario: closed,
      action: 'EXPIRE',
      findTransaction: (hash) => hash === transaction.hash ? transaction : null,
      findStoredTransaction: () => null,
      submitClosure: async () => { closureCalls += 1; return transaction },
      waitTransaction: async (value) => assert.equal(value.hash, transaction.hash),
      checkpointScenario: () => {},
    })
    assert.equal(closureCalls, 1)
    assert.equal(resumed.closureTransaction, transaction.hash)
  })

  test(`${scenarioKey} reconciles an already-finalized closure without duplicating it`, async () => {
    const transaction = { hash: `0xexisting-close-${scenarioKey}` }
    const record = {
      ...scenario(scenarioKey),
      bountyId: 50,
      submissionId: 51,
      closureAction: 'EXPIRE',
      closureTransaction: transaction.hash,
    }
    let closureCalls = 0
    const reconciled = await ensureScenarioClosure({
      scenario: record,
      action: 'EXPIRE',
      findTransaction: (hash) => hash === transaction.hash ? transaction : null,
      findStoredTransaction: () => null,
      submitClosure: async () => { closureCalls += 1; return { hash: '0xduplicate' } },
      waitTransaction: async (value) => assert.equal(value.hash, transaction.hash),
      checkpointScenario: () => {},
    })
    assert.equal(closureCalls, 0)
    assert.equal(reconciled.closureTransaction, transaction.hash)
  })

  test(`${scenarioKey} rejects a mismatched stored closure action`, async () => {
    await assert.rejects(ensureScenarioClosure({
      scenario: {
        ...scenario(scenarioKey),
        bountyId: 60,
        closureAction: 'CANCEL',
        closureTransaction: `0xcancel-${scenarioKey}`,
      },
      action: 'EXPIRE',
      findTransaction: () => ({ hash: `0xcancel-${scenarioKey}` }),
      findStoredTransaction: () => null,
      waitTransaction: async () => {},
      checkpointScenario: () => {},
    }), /does not match required EXPIRE/)
  })
}

test('fails closed for duplicate exact-title or exact-submission recovery records', async () => {
  const record = scenario('mutation')
  await assert.rejects(ensureScenarioBounty({
    scenario: record,
    listBounties: async () => [{ id: 1, title: record.title, poster }, { id: 2, title: record.title, poster }],
    poster,
    findTransaction: () => null,
    findStoredTransaction: () => ({ hash: '0xpost' }),
    waitTransaction: async () => {},
    submitPost: async () => {},
    checkpointScenario: () => {},
  }), /Multiple bounty title/)
  await assert.rejects(ensureScenarioSubmission({
    scenario: { ...record, bountyId: 1 },
    listSubmissions: async () => [
      { id: 1, bounty_id: 1, creator, evidence_uri: record.evidenceUri },
      { id: 2, bounty_id: 1, creator, evidence_uri: record.evidenceUri },
    ],
    creator,
    findTransaction: () => null,
    findStoredTransaction: () => ({ hash: '0xsubmit' }),
    waitTransaction: async () => {},
    submitContent: async () => {},
    checkpointScenario: () => {},
  }), /Multiple submission/)
})
