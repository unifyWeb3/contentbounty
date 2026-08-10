export const MUTATION_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
})

function semanticWorkerState(value) {
  if (value === 'initial') return 'initial'
  if (value === 'mutated' || value === 'changed') return 'mutated'
  return 'unknown'
}

export function normalizeMutationCheckpoint(checkpoint) {
  if (!checkpoint) return { state: MUTATION_STATES.NOT_STARTED, mutableEvidenceUri: null }
  const state = checkpoint.state ?? MUTATION_STATES.NOT_STARTED
  if (!Object.values(MUTATION_STATES).includes(state)) throw new Error(`Unknown mutation checkpoint state: ${state}`)
  if (state !== MUTATION_STATES.NOT_STARTED && typeof checkpoint.mutableEvidenceUri !== 'string') {
    throw new Error('Mutation checkpoint URI is required once mutation has started')
  }
  return { ...checkpoint, state }
}

export function reconcileMutationState(checkpoint, workerState, configuredUri) {
  const current = normalizeMutationCheckpoint(checkpoint)
  const worker = semanticWorkerState(workerState)
  if (worker === 'unknown') throw new Error(`Mutable evidence Worker state is unknown: ${workerState ?? 'MISSING'}`)
  if (current.state !== MUTATION_STATES.NOT_STARTED && current.mutableEvidenceUri !== configuredUri) {
    throw new Error('Mutation checkpoint URI does not match LIVE_MUTABLE_EVIDENCE_URI')
  }
  if (current.state === MUTATION_STATES.NOT_STARTED && worker !== 'initial') {
    throw new Error(`Mutable evidence is not initial: current state is ${worker} without a legitimate mutation checkpoint`)
  }
  if (current.state === MUTATION_STATES.CONFIRMED && worker === 'initial') {
    throw new Error('Mutation is CONFIRMED but the Worker still reports initial state')
  }
  if (current.state === MUTATION_STATES.PENDING && worker === 'mutated') {
    return { ...current, state: MUTATION_STATES.CONFIRMED, reconciled: true }
  }
  return { ...current, reconciled: false }
}

export function beginMutation(checkpoint, mutableEvidenceUri, now = () => new Date().toISOString()) {
  const current = normalizeMutationCheckpoint(checkpoint)
  if (current.state === MUTATION_STATES.CONFIRMED) throw new Error('Mutation is already CONFIRMED')
  if (current.state === MUTATION_STATES.PENDING && current.mutableEvidenceUri !== mutableEvidenceUri) {
    throw new Error('Pending mutation URI does not match configured mutable evidence URI')
  }
  return {
    ...current,
    state: MUTATION_STATES.PENDING,
    mutableEvidenceUri,
    pendingAt: current.pendingAt ?? now(),
  }
}

export function confirmMutation(checkpoint, mutableEvidenceUri, now = () => new Date().toISOString()) {
  const current = normalizeMutationCheckpoint(checkpoint)
  if (current.state !== MUTATION_STATES.PENDING || current.mutableEvidenceUri !== mutableEvidenceUri) {
    throw new Error('Only the matching PENDING mutation may be confirmed')
  }
  return { ...current, state: MUTATION_STATES.CONFIRMED, confirmedAt: now() }
}

export function mutationMayPost(checkpoint, workerState, configuredUri) {
  const reconciled = reconcileMutationState(checkpoint, workerState, configuredUri)
  return reconciled.state !== MUTATION_STATES.CONFIRMED && semanticWorkerState(workerState) === 'initial'
}
