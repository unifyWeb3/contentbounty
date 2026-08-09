function exactUnique(items, predicate, description) {
  const matches = items.filter(predicate)
  if (matches.length > 1) throw new Error(`Multiple ${description} records matched during crash recovery`)
  return matches[0] ?? null
}

function storedTransaction({ explicitHash, findTransaction, findStoredTransaction, description }) {
  if (explicitHash) {
    const transaction = findTransaction(explicitHash)
    if (!transaction) throw new Error(`Stored ${description} transaction ${explicitHash} is absent`)
    return transaction
  }
  return findStoredTransaction?.() ?? null
}

export async function ensureScenarioBounty({
  scenario,
  listBounties,
  poster,
  findTransaction,
  findStoredTransaction,
  waitTransaction,
  submitPost,
  checkpointScenario,
}) {
  checkpointScenario(scenario)
  if (scenario.bountyId !== null) {
    if (!scenario.postTransaction) {
      throw new Error(`Stored bounty ${scenario.title} has no post transaction; refusing ambiguous recovery`)
    }
    return scenario
  }

  const exact = exactUnique(
    await listBounties(),
    (item) => item.title === scenario.title && item.poster?.toLowerCase() === poster.toLowerCase(),
    `bounty title ${scenario.title}`,
  )
  const storedPostTransaction = storedTransaction({
    explicitHash: scenario.postTransaction,
    findTransaction,
    findStoredTransaction,
    description: 'post',
  })
  if (exact) {
    if (!storedPostTransaction) throw new Error(`Recovered bounty ${scenario.title} has no stored post transaction`)
    scenario = { ...scenario, postTransaction: storedPostTransaction.hash }
    checkpointScenario(scenario)
    await waitTransaction(storedPostTransaction)
    scenario = {
      ...scenario,
      bountyId: Number(exact.id),
    }
    checkpointScenario(scenario)
    return scenario
  }
  if (storedPostTransaction) {
    scenario = { ...scenario, postTransaction: storedPostTransaction.hash }
    checkpointScenario(scenario)
    await waitTransaction(storedPostTransaction)
    const afterWait = exactUnique(
      await listBounties(),
      (item) => item.title === scenario.title && item.poster?.toLowerCase() === poster.toLowerCase(),
      `bounty title ${scenario.title}`,
    )
    if (!afterWait) throw new Error(`Stored post transaction finalized but bounty ${scenario.title} was not found`)
    scenario = { ...scenario, bountyId: Number(afterWait.id), postTransaction: storedPostTransaction.hash }
    checkpointScenario(scenario)
    return scenario
  }

  const submittedPostTransaction = await submitPost()
  scenario = { ...scenario, postTransaction: submittedPostTransaction.hash }
  checkpointScenario(scenario)
  await waitTransaction(submittedPostTransaction)
  const created = exactUnique(
    await listBounties(),
    (item) => item.title === scenario.title && item.poster?.toLowerCase() === poster.toLowerCase(),
    `bounty title ${scenario.title}`,
  )
  if (!created) throw new Error(`Posted scenario ${scenario.title} was not found by exact title`)
  scenario = { ...scenario, bountyId: Number(created.id) }
  checkpointScenario(scenario)
  return scenario
}

export async function ensureScenarioSubmission({
  scenario,
  listSubmissions,
  creator,
  findTransaction,
  findStoredTransaction,
  waitTransaction,
  submitContent,
  checkpointScenario,
}) {
  checkpointScenario(scenario)
  if (scenario.submissionId !== null) {
    if (!scenario.submissionTransaction) {
      throw new Error(`Stored submission ${scenario.submissionId} has no submission transaction; refusing ambiguous recovery`)
    }
    return scenario
  }

  const exact = exactUnique(
    await listSubmissions(),
    (item) => Number(item.bounty_id) === Number(scenario.bountyId)
      && item.creator?.toLowerCase() === creator.toLowerCase()
      && item.evidence_uri === scenario.evidenceUri,
    `submission for bounty ${scenario.bountyId}`,
  )
  const storedSubmissionTransaction = storedTransaction({
    explicitHash: scenario.submissionTransaction,
    findTransaction,
    findStoredTransaction,
    description: 'submission',
  })
  if (exact) {
    if (!storedSubmissionTransaction) throw new Error(`Recovered submission ${exact.id} has no stored transaction`)
    scenario = { ...scenario, submissionTransaction: storedSubmissionTransaction.hash }
    checkpointScenario(scenario)
    await waitTransaction(storedSubmissionTransaction)
    scenario = {
      ...scenario,
      submissionId: Number(exact.id),
    }
    checkpointScenario(scenario)
    return scenario
  }
  if (storedSubmissionTransaction) {
    scenario = { ...scenario, submissionTransaction: storedSubmissionTransaction.hash }
    checkpointScenario(scenario)
    await waitTransaction(storedSubmissionTransaction)
    const afterWait = exactUnique(
      await listSubmissions(),
      (item) => Number(item.bounty_id) === Number(scenario.bountyId)
        && item.creator?.toLowerCase() === creator.toLowerCase()
        && item.evidence_uri === scenario.evidenceUri,
      `submission for bounty ${scenario.bountyId}`,
    )
    if (!afterWait) throw new Error(`Stored submission transaction finalized but exact submission was not found`)
    scenario = { ...scenario, submissionId: Number(afterWait.id), submissionTransaction: storedSubmissionTransaction.hash }
    checkpointScenario(scenario)
    return scenario
  }

  const submittedContentTransaction = await submitContent()
  scenario = { ...scenario, submissionTransaction: submittedContentTransaction.hash }
  checkpointScenario(scenario)
  await waitTransaction(submittedContentTransaction)
  const created = exactUnique(
    await listSubmissions(),
    (item) => Number(item.bounty_id) === Number(scenario.bountyId)
      && item.creator?.toLowerCase() === creator.toLowerCase()
      && item.evidence_uri === scenario.evidenceUri,
    `submission for bounty ${scenario.bountyId}`,
  )
  if (!created) throw new Error(`Submitted scenario ${scenario.scenarioKey} was not found exactly`)
  scenario = { ...scenario, submissionId: Number(created.id) }
  checkpointScenario(scenario)
  return scenario
}

export async function ensureScenarioEvaluation({
  scenario,
  findTransaction,
  waitTransaction,
  submitEvaluation,
  readSubmission,
  checkpointScenario,
}) {
  checkpointScenario(scenario)
  const storedTransaction = scenario.evaluationTransaction
    ? findTransaction(scenario.evaluationTransaction)
    : null
  if (storedTransaction) {
    await waitTransaction(storedTransaction)
    return { scenario, submission: await readSubmission() }
  }
  if (scenario.evaluationTransaction) {
    throw new Error(`Stored evaluation transaction ${scenario.evaluationTransaction} is absent`)
  }
  const transaction = await submitEvaluation()
  scenario = { ...scenario, evaluationTransaction: transaction.hash }
  checkpointScenario(scenario)
  await waitTransaction(transaction)
  return { scenario, submission: await readSubmission() }
}

export async function ensureScenarioClosure({
  scenario,
  action,
  findTransaction,
  findStoredTransaction,
  waitTransaction,
  submitClosure,
  checkpointScenario,
}) {
  checkpointScenario(scenario)
  if (scenario.closureAction && scenario.closureAction !== action) {
    throw new Error(
      `Stored closure action ${scenario.closureAction} does not match required ${action} for ${scenario.title}`,
    )
  }
  const transaction = storedTransaction({
    explicitHash: scenario.closureTransaction,
    findTransaction,
    findStoredTransaction,
    description: `${action.toLowerCase()} closure`,
  })
  if (transaction) {
    scenario = {
      ...scenario,
      closureAction: action,
      closureTransaction: transaction.hash,
    }
    checkpointScenario(scenario)
    await waitTransaction(transaction)
    return scenario
  }
  if (!submitClosure) {
    throw new Error(`Closed scenario ${scenario.title} has no stored ${action.toLowerCase()} transaction`)
  }
  const submitted = await submitClosure()
  scenario = {
    ...scenario,
    closureAction: action,
    closureTransaction: submitted.hash,
  }
  checkpointScenario(scenario)
  await waitTransaction(submitted)
  return scenario
}
