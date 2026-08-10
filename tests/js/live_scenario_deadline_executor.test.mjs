import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureDeadlineSafeScenarioSubmission } from '../../scripts/live-scenario-executor.mjs'
import {
  createScenarioRecord,
  replaceScenarioRecord,
  scenarioDeadlineAction,
} from '../../scripts/live-scenario-recovery.mjs'

function initialScenario(scenarioKey) {
  return {
    ...createScenarioRecord({
      scenarioKey,
      baseTitle: scenarioKey === 'mutation'
        ? 'Live mutation inconclusive'
        : 'Live clear approval and payout',
      evidenceUri: `https://evidence.example/${scenarioKey}.txt`,
      generatedAt: '2026-08-10T00:00:00Z',
    }),
    postTransaction: `0xexisting-post-${scenarioKey}`,
  }
}

function bounty(id, title, overrides = {}) {
  return {
    id,
    title,
    poster: '0xposter',
    reward: 1_000_000_000_000_000n,
    description: 'Live consensus integration evidence.',
    rubric_json: '[]',
    rubric_version: 'content-bounty-rubric-v2',
    status: 'OPEN',
    submission_deadline: 200,
    evaluation_deadline: 300,
    ...overrides,
  }
}

function harness({ scenario, firstBounty, chainTimestamps, closureStatus = null }) {
  const events = []
  const checkpoints = []
  const bounties = new Map([[1, firstBounty]])
  let nextBountyId = 2
  let postWrites = 0
  let submissionWrites = 0
  let closureWrites = 0

  const input = {
    scenario,
    ensureBounty: async (record) => {
      events.push(`ensure-bounty:${record.title}`)
      if (record.bountyId !== null) return record
      if (record.postTransaction) return { ...record, bountyId: 1 }
      postWrites += 1
      const id = nextBountyId
      nextBountyId += 1
      bounties.set(id, bounty(id, record.title, {
        submission_deadline: 500,
        evaluation_deadline: 700,
      }))
      return { ...record, bountyId: id, postTransaction: `0xpost-${id}` }
    },
    ensureSubmission: async (record) => {
      events.push(`ensure-submission:${record.title}`)
      if (record.submissionId !== null) return record
      submissionWrites += 1
      return {
        ...record,
        submissionId: 10 + record.bountyId,
        submissionTransaction: record.submissionTransaction ?? `0xsubmit-${record.bountyId}`,
      }
    },
    readBounty: async (id) => {
      events.push(`read-bounty:${id}`)
      return bounties.get(id)
    },
    validateBounty: (record, current) => ({
      ...record,
      status: current.status,
      submissionDeadline: current.submission_deadline,
      evaluationDeadline: current.evaluation_deadline,
    }),
    readSubmission: async (id) => ({
      id,
      bounty_id: scenario.bountyId,
      creator: '0xcreator',
      evidence_uri: scenario.evidenceUri,
      status: 'PENDING',
    }),
    validateSubmission: (record) => record,
    readChainTimestamp: async () => {
      events.push('read-chain-timestamp')
      if (!chainTimestamps.length) throw new Error('missing chain timestamp fixture')
      return chainTimestamps.shift()
    },
    classifyDeadline: scenarioDeadlineAction,
    reconcileClosure: async (record, current, action) => {
      events.push(`reconcile-closure:${action.action}`)
      const actionName = action.action === 'CANCEL_AND_REPLACE' || action.reason === 'CANCELLED'
        ? 'CANCEL'
        : 'EXPIRE'
      if (!record.closureTransaction) closureWrites += 1
      const status = closureStatus ?? (actionName === 'CANCEL' ? 'CANCELLED' : 'EXPIRED')
      const closed = { ...current, status }
      bounties.set(record.bountyId, closed)
      return {
        scenario: {
          ...record,
          closureAction: actionName,
          closureTransaction: record.closureTransaction ?? `0x${actionName.toLowerCase()}-${record.bountyId}`,
        },
        bounty: closed,
        action: { action: 'TERMINAL', reason: status },
      }
    },
    replaceScenario: (record) => replaceScenarioRecord(record, '2026-08-10T01:00:00Z'),
    checkpointScenario: (record) => checkpoints.push(structuredClone(record)),
  }

  return {
    input,
    events,
    checkpoints,
    counts: () => ({ postWrites, submissionWrites, closureWrites }),
  }
}

for (const scenarioKey of ['mutation', 'clear-approval']) {
  test(`${scenarioKey}: recovered post remains open and submits only after fresh deadline read`, async () => {
    const scenario = initialScenario(scenarioKey)
    const fixture = harness({
      scenario,
      firstBounty: bounty(1, scenario.title),
      chainTimestamps: [150],
    })
    const result = await ensureDeadlineSafeScenarioSubmission(fixture.input)
    assert.equal(result.bountyId, 1)
    assert.equal(result.submissionId, 11)
    assert.deepEqual(fixture.counts(), { postWrites: 0, submissionWrites: 1, closureWrites: 0 })
    assert.ok(fixture.events.indexOf('read-chain-timestamp') < fixture.events.indexOf(`ensure-submission:${scenario.title}`))
  })

  test(`${scenarioKey}: deadline passes during RPC downtime, cancels once, replaces once, then submits`, async () => {
    const scenario = initialScenario(scenarioKey)
    const fixture = harness({
      scenario,
      firstBounty: bounty(1, scenario.title, {
        submission_deadline: 100,
        evaluation_deadline: 300,
      }),
      chainTimestamps: [150, 160],
    })
    const result = await ensureDeadlineSafeScenarioSubmission(fixture.input)
    assert.equal(result.bountyId, 2)
    assert.equal(result.history.length, 1)
    assert.equal(result.history[0].closureAction, 'CANCEL')
    assert.equal(result.history[0].closureTransaction, '0xcancel-1')
    assert.deepEqual(fixture.counts(), { postWrites: 1, submissionWrites: 1, closureWrites: 1 })
  })
}

test('uses expire after evaluation deadline and cancel only before evaluation deadline', async () => {
  const cancelScenario = initialScenario('mutation')
  const cancel = harness({
    scenario: cancelScenario,
    firstBounty: bounty(1, cancelScenario.title, { submission_deadline: 100, evaluation_deadline: 300 }),
    chainTimestamps: [101, 102],
  })
  await ensureDeadlineSafeScenarioSubmission(cancel.input)
  assert.ok(cancel.events.includes('reconcile-closure:CANCEL_AND_REPLACE'))

  const expireScenario = initialScenario('mutation')
  const expire = harness({
    scenario: expireScenario,
    firstBounty: bounty(1, expireScenario.title, { submission_deadline: 100, evaluation_deadline: 200 }),
    chainTimestamps: [201, 202],
  })
  const result = await ensureDeadlineSafeScenarioSubmission(expire.input)
  assert.ok(expire.events.includes('reconcile-closure:EXPIRE_AND_REPLACE'))
  assert.equal(result.history[0].closureAction, 'EXPIRE')
  assert.equal(result.history[0].closureTransaction, '0xexpire-1')
})

test('restart with a checkpointed closure recovers it and does not duplicate closure or original post', async () => {
  const scenario = {
    ...initialScenario('mutation'),
    bountyId: 1,
    closureAction: 'CANCEL',
    closureTransaction: '0xcancel-1',
  }
  const fixture = harness({
    scenario,
    firstBounty: bounty(1, scenario.title, { submission_deadline: 100, evaluation_deadline: 300 }),
    chainTimestamps: [150, 160],
  })
  const result = await ensureDeadlineSafeScenarioSubmission(fixture.input)
  assert.equal(result.bountyId, 2)
  assert.deepEqual(fixture.counts(), { postWrites: 1, submissionWrites: 1, closureWrites: 0 })
  assert.equal(result.history[0].closureTransaction, '0xcancel-1')
})

test('recovers an existing submission, preserves its evaluation window, and expires it only after grace', async () => {
  const activeScenario = {
    ...initialScenario('clear-approval'),
    bountyId: 1,
    submissionId: 11,
    submissionTransaction: '0xsubmit-1',
  }
  const active = harness({
    scenario: activeScenario,
    firstBounty: bounty(1, activeScenario.title, {
      status: 'LOCKED',
      submission_deadline: 100,
      evaluation_deadline: 200,
    }),
    chainTimestamps: [150],
  })
  const recovered = await ensureDeadlineSafeScenarioSubmission(active.input)
  assert.equal(recovered.submissionId, 11)
  assert.deepEqual(active.counts(), { postWrites: 0, submissionWrites: 0, closureWrites: 0 })

  const expired = harness({
    scenario: activeScenario,
    firstBounty: bounty(1, activeScenario.title, {
      status: 'LOCKED',
      submission_deadline: 100,
      evaluation_deadline: 200,
    }),
    chainTimestamps: [201, 202],
  })
  const replacement = await ensureDeadlineSafeScenarioSubmission(expired.input)
  assert.equal(replacement.bountyId, 2)
  assert.equal(replacement.history[0].closureAction, 'EXPIRE')
  assert.deepEqual(expired.counts(), { postWrites: 1, submissionWrites: 1, closureWrites: 1 })
})

test('restart from replacement checkpoint posts once, while restart after its post recovers without reposting', async () => {
  const expired = {
    ...initialScenario('clear-approval'),
    bountyId: 1,
    status: 'CANCELLED',
    closureAction: 'CANCEL',
    closureTransaction: '0xcancel-1',
    replacementReason: 'CANCELLED',
  }
  const replacement = replaceScenarioRecord(expired, '2026-08-10T01:00:00Z')
  const first = harness({
    scenario: replacement,
    firstBounty: bounty(1, expired.title, { status: 'CANCELLED' }),
    chainTimestamps: [160],
  })
  const posted = await ensureDeadlineSafeScenarioSubmission(first.input)
  assert.deepEqual(first.counts(), { postWrites: 1, submissionWrites: 1, closureWrites: 0 })

  const recoveredScenario = {
    ...replacement,
    postTransaction: posted.postTransaction,
  }
  const recoveredBounty = bounty(1, recoveredScenario.title, {
    submission_deadline: 500,
    evaluation_deadline: 700,
  })
  const second = harness({
    scenario: recoveredScenario,
    firstBounty: recoveredBounty,
    chainTimestamps: [160],
  })
  await ensureDeadlineSafeScenarioSubmission(second.input)
  assert.deepEqual(second.counts(), { postWrites: 0, submissionWrites: 1, closureWrites: 0 })
})
