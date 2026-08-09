import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BRADBURY_SCENARIO_WINDOW_SECONDS,
  createScenarioRecord,
  replaceScenarioRecord,
  scenarioDeadlineAction,
  validateStoredBountyScenario,
  validateStoredSubmissionScenario,
} from '../../scripts/live-scenario-recovery.mjs'

const creator = '0x0000000000000000000000000000000000000001'
const poster = '0x0000000000000000000000000000000000000002'
const uri = 'https://evidence.example/mutable.txt'

test('uses exact stored IDs and validates on-chain identity', () => {
  const scenario = { ...createScenarioRecord({ scenarioKey: 'mutation', baseTitle: 'Mutable', evidenceUri: uri, generatedAt: '2026-08-09T01:02:03Z' }), bountyId: 4, submissionId: 8 }
  const bounty = { id: 4, title: scenario.title, poster, status: 'LOCKED', submission_deadline: 100, evaluation_deadline: 200 }
  const submission = { id: 8, bounty_id: 4, creator, evidence_uri: uri, status: 'PENDING' }
  assert.equal(validateStoredBountyScenario(scenario, bounty, poster).bountyId, 4)
  assert.equal(validateStoredSubmissionScenario(scenario, submission, creator).submissionId, 8)
  assert.throws(() => validateStoredBountyScenario(scenario, { ...bounty, id: 5 }, poster), /bounty ID mismatch/)
  assert.throws(() => validateStoredSubmissionScenario(scenario, { ...submission, evidence_uri: 'https://other' }, creator), /evidence URI mismatch/)
})

test('selects reuse, expiry replacement, and does not reuse expired title matches', () => {
  assert.equal(scenarioDeadlineAction({ bounty: { status: 'LOCKED', submission_deadline: 100, evaluation_deadline: 200 }, submission: { status: 'PENDING' }, chainTimestamp: 199 }).action, 'REUSE')
  assert.equal(scenarioDeadlineAction({ bounty: { status: 'LOCKED', submission_deadline: 100, evaluation_deadline: 200 }, submission: { status: 'PENDING' }, chainTimestamp: 201 }).action, 'EXPIRE_AND_REPLACE')
  const replaced = replaceScenarioRecord({ ...createScenarioRecord({ scenarioKey: 'approval', baseTitle: 'Approval', evidenceUri: uri, generatedAt: '2026-08-09T01:02:03Z' }), bountyId: 4, status: 'EXPIRED' }, '2026-08-09T02:00:00Z')
  assert.notEqual(replaced.title, 'Approval')
  assert.equal(replaced.submissionWindowSeconds, BRADBURY_SCENARIO_WINDOW_SECONDS)
  assert.equal(replaced.evaluationGraceSeconds, BRADBURY_SCENARIO_WINDOW_SECONDS)
})

test('preserves exact closure transaction in replacement history', () => {
  const original = {
    ...createScenarioRecord({ scenarioKey: 'mutation', baseTitle: 'Mutable', evidenceUri: uri, generatedAt: '2026-08-09T01:02:03Z' }),
    bountyId: 1,
    submissionId: 1,
    status: 'EXPIRED',
    closureAction: 'EXPIRE',
    closureTransaction: '0xda8b176f3671b7fe4cfd2f2b23801377285119f0267144903b619f68e3ffc8d4',
  }
  const replaced = replaceScenarioRecord(original, '2026-08-09T02:00:00Z')
  assert.equal(replaced.history[0].closureAction, 'EXPIRE')
  assert.equal(replaced.history[0].closureTransaction, original.closureTransaction)
  assert.equal(replaced.closureTransaction, null)
})

test('replaces a no-submission scenario after its submission deadline and rejects terminal reuse', () => {
  assert.equal(scenarioDeadlineAction({
    bounty: { status: 'OPEN', submission_deadline: 100, evaluation_deadline: 200 },
    chainTimestamp: 101,
  }).action, 'CANCEL_AND_REPLACE')
  assert.deepEqual(scenarioDeadlineAction({
    bounty: { status: 'FILLED', submission_deadline: 100, evaluation_deadline: 200 },
    submission: { status: 'APPROVED' },
    chainTimestamp: 150,
  }), { action: 'TERMINAL', reason: 'FILLED' })
})
