export const BRADBURY_SCENARIO_WINDOW_SECONDS = 4 * 60 * 60

const ACTIVE_BOUNTY_STATUSES = new Set(['OPEN', 'LOCKED'])
const TERMINAL_SUBMISSION_STATUSES = new Set(['APPROVED', 'REJECTED', 'SUPERSEDED'])

function integerId(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} is invalid`)
  return number
}

export function uniqueScenarioTitle(baseTitle, generatedAt, sequence = 1) {
  const stamp = String(generatedAt).replace(/[^0-9]/g, '').slice(0, 14) || 'unknown'
  return `${baseTitle} [${stamp}-${sequence}]`
}

export function createScenarioRecord({ scenarioKey, baseTitle, evidenceUri, generatedAt, sequence = 1 }) {
  return {
    scenarioKey,
    title: uniqueScenarioTitle(baseTitle, generatedAt, sequence),
    evidenceUri,
    bountyId: null,
    submissionId: null,
    postTransaction: null,
    submissionTransaction: null,
    evaluationTransaction: null,
    closureAction: null,
    closureTransaction: null,
    submissionWindowSeconds: BRADBURY_SCENARIO_WINDOW_SECONDS,
    evaluationGraceSeconds: BRADBURY_SCENARIO_WINDOW_SECONDS,
    history: [],
  }
}

export function migrateUniqueLegacyScenario({ bounties, baseTitle, poster, evidenceUri, scenarioKey }) {
  const matches = bounties.filter((item) =>
    item.title === baseTitle && item.poster?.toLowerCase() === poster.toLowerCase())
  if (matches.length > 1) throw new Error(`Multiple legacy ${scenarioKey} bounties match title ${baseTitle}`)
  if (matches.length === 0) return null
  const bounty = matches[0]
  return {
    scenarioKey,
    title: bounty.title,
    evidenceUri,
    bountyId: integerId(bounty.id, `${scenarioKey} bounty ID`),
    submissionId: null,
    postTransaction: null,
    submissionTransaction: null,
    evaluationTransaction: null,
    closureAction: null,
    closureTransaction: null,
    submissionDeadline: Number(bounty.submission_deadline),
    evaluationDeadline: Number(bounty.evaluation_deadline),
    status: bounty.status,
    migratedLegacyScenario: true,
    history: [],
  }
}

export function validateStoredBountyScenario(record, bounty, poster) {
  if (!record || record.bountyId === null || record.bountyId === undefined) {
    throw new Error('Stored scenario does not contain a bounty ID')
  }
  if (integerId(bounty.id, 'On-chain bounty ID') !== integerId(record.bountyId, 'Stored bounty ID')) {
    throw new Error(`Stored scenario bounty ID mismatch for ${record.scenarioKey}`)
  }
  if (bounty.title !== record.title) throw new Error(`Stored scenario title mismatch for ${record.scenarioKey}`)
  if (bounty.poster?.toLowerCase() !== poster.toLowerCase()) {
    throw new Error(`Stored scenario poster mismatch for ${record.scenarioKey}`)
  }
  return {
    ...record,
    submissionDeadline: Number(bounty.submission_deadline),
    evaluationDeadline: Number(bounty.evaluation_deadline),
    status: bounty.status,
  }
}

export function validateLiveBountyScenario(record, bounty, poster, expected) {
  const validated = validateStoredBountyScenario(record, bounty, poster)
  let reward
  try {
    reward = BigInt(bounty.reward)
  } catch {
    throw new Error(`Stored scenario reward is malformed for ${record.scenarioKey}`)
  }
  if (reward !== BigInt(expected.reward)) {
    throw new Error(`Stored scenario reward mismatch for ${record.scenarioKey}`)
  }
  if (record.evidenceUri !== expected.evidenceUri) {
    throw new Error(`Stored ${record.scenarioKey} evidence URI does not match configured evidence URI`)
  }
  if (bounty.description !== expected.description) {
    throw new Error(`Stored scenario description mismatch for ${record.scenarioKey}`)
  }
  if (bounty.rubric_json !== expected.rubricJson || bounty.rubric_version !== expected.rubricVersion) {
    throw new Error(`Stored scenario rubric mismatch for ${record.scenarioKey}`)
  }
  const submissionDeadline = Number(bounty.submission_deadline)
  const evaluationDeadline = Number(bounty.evaluation_deadline)
  if (
    !Number.isSafeInteger(submissionDeadline)
    || !Number.isSafeInteger(evaluationDeadline)
    || submissionDeadline <= 0
    || evaluationDeadline <= submissionDeadline
  ) {
    throw new Error(`Stored scenario deadlines are malformed for ${record.scenarioKey}`)
  }
  if (!['OPEN', 'LOCKED', 'FILLED', 'CANCELLED', 'EXPIRED'].includes(bounty.status)) {
    throw new Error(`Stored scenario status is unknown for ${record.scenarioKey}: ${bounty.status}`)
  }
  return validated
}

export function validateStoredSubmissionScenario(record, submission, creator) {
  if (record.submissionId === null || record.submissionId === undefined) {
    throw new Error('Stored scenario does not contain a submission ID')
  }
  if (integerId(submission.id, 'On-chain submission ID') !== integerId(record.submissionId, 'Stored submission ID')) {
    throw new Error(`Stored scenario submission ID mismatch for ${record.scenarioKey}`)
  }
  if (integerId(submission.bounty_id, 'Submission bounty ID') !== integerId(record.bountyId, 'Stored bounty ID')) {
    throw new Error(`Stored scenario submission bounty mismatch for ${record.scenarioKey}`)
  }
  if (submission.creator?.toLowerCase() !== creator.toLowerCase()) {
    throw new Error(`Stored scenario submission creator mismatch for ${record.scenarioKey}`)
  }
  if (submission.evidence_uri !== record.evidenceUri) {
    throw new Error(`Stored scenario evidence URI mismatch for ${record.scenarioKey}`)
  }
  return { ...record, submissionStatus: submission.status }
}

export function scenarioDeadlineAction({ bounty, submission = null, chainTimestamp }) {
  const now = Number(chainTimestamp)
  const submissionDeadline = Number(bounty.submission_deadline)
  const evaluationDeadline = Number(bounty.evaluation_deadline)
  if (![now, submissionDeadline, evaluationDeadline].every(Number.isFinite)) {
    throw new Error('Scenario deadline data is malformed')
  }
  if (!ACTIVE_BOUNTY_STATUSES.has(bounty.status)) return { action: 'TERMINAL', reason: bounty.status }
  if (submission && TERMINAL_SUBMISSION_STATUSES.has(submission.status)) {
    return { action: 'TERMINAL', reason: submission.status }
  }
  if (now > evaluationDeadline) return { action: 'EXPIRE_AND_REPLACE', reason: 'EVALUATION_DEADLINE_PASSED' }
  if (!submission && now > submissionDeadline) return { action: 'CANCEL_AND_REPLACE', reason: 'SUBMISSION_DEADLINE_PASSED' }
  return { action: 'REUSE', reason: submission ? 'EVALUATION_WINDOW_OPEN' : 'SUBMISSION_WINDOW_OPEN' }
}

export function replaceScenarioRecord(record, generatedAt) {
  const history = [...(record.history ?? []), {
    title: record.title,
    bountyId: record.bountyId,
    submissionId: record.submissionId,
    evidenceUri: record.evidenceUri,
    postTransaction: record.postTransaction,
    submissionTransaction: record.submissionTransaction,
    evaluationTransaction: record.evaluationTransaction,
    closureAction: record.closureAction,
    closureTransaction: record.closureTransaction,
    submissionDeadline: record.submissionDeadline,
    evaluationDeadline: record.evaluationDeadline,
    status: record.status,
    replacementReason: record.replacementReason,
  }]
  const sequence = history.length + 1
  const baseTitle = record.title.replace(/ \[[0-9]+-[0-9]+\]$/, '')
  return {
    ...createScenarioRecord({
      scenarioKey: record.scenarioKey,
      baseTitle,
      evidenceUri: record.evidenceUri,
      generatedAt,
      sequence,
    }),
    history,
  }
}

export function replaceTerminallyFailedPostScenario(record, transaction, generatedAt) {
  if (!record.postTransaction || record.postTransaction.toLowerCase() !== transaction?.hash?.toLowerCase()) {
    throw new Error(`Failed post transaction does not match stored scenario ${record.scenarioKey}`)
  }
  const observation = transaction.observations?.at(-1)
  if (observation?.phase !== 'FAILED' || observation.terminal !== true) return null
  return replaceScenarioRecord({
    ...record,
    status: 'POST_TRANSACTION_FAILED',
    replacementReason: observation.failureReason
      ? `POST_TRANSACTION_FAILED: ${observation.failureReason}`
      : 'POST_TRANSACTION_FAILED',
  }, generatedAt)
}
