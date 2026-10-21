/**
 * The single source of truth for which contract actions the interface may
 * offer.
 *
 * Every rule here mirrors a precondition in `contracts/content_bounty.py`.
 * The vocabulary in this file is checked against the constants parsed out of
 * the contract source by `statusActions.test.ts`, so the interface and the
 * contract cannot drift apart silently.
 */

export const BOUNTY_STATUSES = ['OPEN', 'LOCKED', 'FILLED', 'CANCELLED', 'EXPIRED'] as const
export type BountyStatus = (typeof BOUNTY_STATUSES)[number]

export const SUBMISSION_STATUSES = [
  'PENDING',
  'APPROVED_PENDING',
  'APPROVED',
  'REJECTED',
  'INCONCLUSIVE',
  'SUPERSEDED',
] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export const CHALLENGE_STATUSES = ['OPEN', 'UPHELD', 'DISMISSED', 'TIMED_OUT'] as const
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number]

export const LIABILITY_STATUSES = ['', 'PENDING', 'WITHDRAWN'] as const
export type LiabilityStatus = (typeof LIABILITY_STATUSES)[number]

export const BOND_STATUSES = ['ESCROWED', 'PENDING', 'WITHDRAWN'] as const
export type BondStatus = (typeof BOND_STATUSES)[number]

export const VERDICT_CODES = [
  '',
  'ALL_CRITERIA_MET',
  'NOT_ALL_CRITERIA_MET',
  'EVIDENCE_UNVERIFIED',
  'CLAIM_TAG_MISSING',
  'CHALLENGE_UPHELD',
] as const
export type VerdictCode = (typeof VERDICT_CODES)[number]

export const CHALLENGE_OUTCOMES = ['', 'UPHOLD', 'DISMISS', 'INCONCLUSIVE'] as const
export type ChallengeOutcome = (typeof CHALLENGE_OUTCOMES)[number]

export const MAX_EVALUATION_ATTEMPTS = 3
export const MAX_CHALLENGE_ATTEMPTS = 3
export const MAX_SUBMISSIONS_PER_BOUNTY = 64

export type BountyAction = 'submit' | 'cancel' | 'expire' | 'withdraw_refund'
export type SubmissionAction = 'evaluate' | 'challenge' | 'claim' | 'withdraw_reward'
export type ChallengeAction = 'review' | 'finalize' | 'timeout' | 'withdraw_bond'

export interface BountyState {
  id: number
  poster: string
  status: BountyStatus
  submission_deadline: number
  evaluation_deadline: number
  challenge_window_seconds: number
  submission_count: number
  has_winner: boolean
  has_provisional_winner: boolean
  provisional_submission_id: number
  refund_status: LiabilityStatus
  refund_amount: number
  escrow_balance: number
}

export interface SubmissionState {
  id: number
  bounty_id: number
  creator: string
  status: SubmissionStatus
  attempt_count: number
  challenge_deadline: number
  active_challenge_id: number
  reward_claimed: boolean
  reward_status: LiabilityStatus
  reward_amount: number
}

export interface ChallengeState {
  id: number
  status: ChallengeStatus
  review_deadline: number
  attempt_count: number
  proposed_outcome: ChallengeOutcome
  bond: number
  bond_status: BondStatus
  bond_recipient: string
}

export interface ActionInput {
  now: number
  wallet: string | null
  bounty: BountyState | null
  submissions: SubmissionState[]
  challenges: ChallengeState[]
}

export interface ActionSet {
  bounty: BountyAction[]
  submission: Record<number, SubmissionAction[]>
  challenge: Record<number, ChallengeAction[]>
}

export function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Derive every action the contract would accept for the given state.
 *
 * This is a pure function of contract state and the wallet address. It never
 * looks at the network, and it is the only place the interface decides what
 * may be offered to the user.
 */
export function availableActions(input: ActionInput): ActionSet {
  const { now, wallet, bounty, submissions, challenges } = input
  const set: ActionSet = { bounty: [], submission: {}, challenge: {} }

  if (!bounty) return set

  const activeChallenge = submissions.some((submission) => submission.active_challenge_id !== 0)
  const creatorSubmitted = submissions.some(
    (submission) => sameAddress(submission.creator, wallet),
  )
  const isPoster = sameAddress(bounty.poster, wallet)

  // post_bounty / submit_content
  if (
    (bounty.status === 'OPEN' || bounty.status === 'LOCKED')
    && now <= bounty.submission_deadline
    && bounty.submission_count < MAX_SUBMISSIONS_PER_BOUNTY
    && !creatorSubmitted
  ) {
    set.bounty.push('submit')
  }

  // cancel_bounty
  if (
    isPoster
    && bounty.status === 'OPEN'
    && bounty.submission_count === 0
    && !bounty.has_provisional_winner
    && !activeChallenge
    && bounty.refund_status === ''
  ) {
    set.bounty.push('cancel')
  }

  // expire_bounty
  if (
    (bounty.status === 'OPEN' || bounty.status === 'LOCKED')
    && now > bounty.evaluation_deadline
    && !bounty.has_winner
    && !bounty.has_provisional_winner
    && !activeChallenge
    && bounty.refund_status === ''
  ) {
    set.bounty.push('expire')
  }

  // withdraw_refund
  if (isPoster && bounty.refund_status === 'PENDING' && bounty.refund_amount > 0) {
    set.bounty.push('withdraw_refund')
  }

  for (const submission of submissions) {
    const actions: SubmissionAction[] = []
    const isCreator = sameAddress(submission.creator, wallet)

    // evaluate_submission
    if (
      (submission.status === 'PENDING' || submission.status === 'INCONCLUSIVE')
      && submission.attempt_count < MAX_EVALUATION_ATTEMPTS
      && (bounty.status === 'OPEN' || bounty.status === 'LOCKED')
      && now <= bounty.evaluation_deadline
      && (!bounty.has_provisional_winner
        || bounty.provisional_submission_id === submission.id)
    ) {
      actions.push('evaluate')
    }

    // challenge_submission
    if (
      submission.status === 'APPROVED_PENDING'
      && submission.active_challenge_id === 0
      && now < submission.challenge_deadline
      && !isCreator
    ) {
      actions.push('challenge')
    }

    // claim_reward
    if (
      isCreator
      && submission.status === 'APPROVED_PENDING'
      && now >= submission.challenge_deadline
      && submission.active_challenge_id === 0
      && !submission.reward_claimed
      && submission.reward_status === ''
      && bounty.status === 'LOCKED'
      && bounty.has_provisional_winner
      && bounty.provisional_submission_id === submission.id
    ) {
      actions.push('claim')
    }

    // withdraw_reward
    if (isCreator && submission.reward_status === 'PENDING' && submission.reward_amount > 0) {
      actions.push('withdraw_reward')
    }

    set.submission[submission.id] = actions
  }

  for (const challenge of challenges) {
    const actions: ChallengeAction[] = []

    // review_challenge
    if (
      challenge.status === 'OPEN'
      && now < challenge.review_deadline
      && challenge.attempt_count < MAX_CHALLENGE_ATTEMPTS
      && (challenge.proposed_outcome === '' || challenge.proposed_outcome === 'INCONCLUSIVE')
    ) {
      actions.push('review')
    }

    // finalize_challenge
    if (
      challenge.status === 'OPEN'
      && (challenge.proposed_outcome === 'UPHOLD' || challenge.proposed_outcome === 'DISMISS')
    ) {
      actions.push('finalize')
    }

    // timeout_challenge
    if (
      challenge.status === 'OPEN'
      && (challenge.proposed_outcome === '' || challenge.proposed_outcome === 'INCONCLUSIVE')
      && (challenge.attempt_count >= MAX_CHALLENGE_ATTEMPTS || now >= challenge.review_deadline)
    ) {
      actions.push('timeout')
    }

    // withdraw_bond
    if (
      challenge.bond_status === 'PENDING'
      && challenge.bond > 0
      && sameAddress(challenge.bond_recipient, wallet)
    ) {
      actions.push('withdraw_bond')
    }

    set.challenge[challenge.id] = actions
  }

  return set
}
