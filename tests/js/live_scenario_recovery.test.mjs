import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BRADBURY_SCENARIO_WINDOW_SECONDS,
  createScenarioRecord,
  replaceTerminallyFailedPostScenario,
  replaceScenarioRecord,
  scenarioDeadlineAction,
  validateLiveBountyScenario,
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

test('validates exact live reward, rubric, evidence configuration, status, and deadlines', () => {
  const scenario = {
    ...createScenarioRecord({ scenarioKey: 'mutation', baseTitle: 'Mutable', evidenceUri: uri, generatedAt: '2026-08-09T01:02:03Z' }),
    bountyId: 4,
  }
  const bounty = {
    id: 4,
    title: scenario.title,
    poster,
    reward: 1_000_000_000_000_000n,
    description: 'Live consensus integration evidence.',
    rubric_json: '[]',
    rubric_version: 'content-bounty-rubric-v2',
    status: 'OPEN',
    submission_deadline: 100,
    evaluation_deadline: 200,
  }
  const expected = {
    reward: 1_000_000_000_000_000n,
    evidenceUri: uri,
    description: bounty.description,
    rubricJson: bounty.rubric_json,
    rubricVersion: bounty.rubric_version,
  }
  assert.equal(validateLiveBountyScenario(scenario, bounty, poster, expected).bountyId, 4)
  assert.throws(() => validateLiveBountyScenario(scenario, { ...bounty, reward: 1n }, poster, expected), /reward mismatch/)
  assert.throws(() => validateLiveBountyScenario({ ...scenario, evidenceUri: 'https://other' }, bounty, poster, expected), /evidence URI/)
  assert.throws(() => validateLiveBountyScenario(scenario, { ...bounty, rubric_json: '[{}]' }, poster, expected), /rubric mismatch/)
  assert.throws(() => validateLiveBountyScenario(scenario, { ...bounty, status: 'UNKNOWN' }, poster, expected), /status is unknown/)
  assert.throws(() => validateLiveBountyScenario(scenario, { ...bounty, evaluation_deadline: 100 }, poster, expected), /deadlines are malformed/)
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

test('replaces only an exact terminally failed post, never accepted or RPC-ambiguous state', () => {
  const scenario = {
    ...createScenarioRecord({ scenarioKey: 'mutation', baseTitle: 'Mutable', evidenceUri: uri, generatedAt: '2026-08-09T01:02:03Z' }),
    postTransaction: '0xfailed-post',
  }
  const failed = {
    hash: scenario.postTransaction,
    observations: [{ phase: 'FAILED', terminal: true, failureReason: 'Leader timed out.' }],
  }
  const replacement = replaceTerminallyFailedPostScenario(scenario, failed, '2026-08-10T01:00:00Z')
  assert.equal(replacement.history[0].postTransaction, scenario.postTransaction)
  assert.match(replacement.history[0].replacementReason, /Leader timed out/)
  assert.equal(replacement.postTransaction, null)
  assert.equal(replaceTerminallyFailedPostScenario(scenario, {
    hash: scenario.postTransaction,
    observations: [{ phase: 'ACCEPTED', terminal: false }],
  }, '2026-08-10T01:00:00Z'), null)
  assert.equal(replaceTerminallyFailedPostScenario(scenario, {
    hash: scenario.postTransaction,
    observations: [{ phase: 'FAILED', terminal: false }],
  }, '2026-08-10T01:00:00Z'), null)
  assert.throws(() => replaceTerminallyFailedPostScenario(scenario, {
    hash: '0xother',
    observations: [{ phase: 'FAILED', terminal: true }],
  }, '2026-08-10T01:00:00Z'), /does not match/)
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
