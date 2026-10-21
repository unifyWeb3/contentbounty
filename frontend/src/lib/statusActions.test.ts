import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  BOUNTY_STATUSES,
  CHALLENGE_STATUSES,
  LIABILITY_STATUSES,
  SUBMISSION_STATUSES,
  VERDICT_CODES,
  availableActions,
  sameAddress,
  type BountyState,
  type ChallengeState,
  type SubmissionState,
} from './statusActions'

const CONTRACT_SOURCE = fileURLToPath(new URL('../../../contracts/content_bounty.py', import.meta.url))

function contractConstants(): Record<string, string> {
  const source = readFileSync(CONTRACT_SOURCE, 'utf8')
  const constants: Record<string, string> = {}
  const pattern = /^([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    constants[match[1]] = match[2]
  }
  return constants
}

function bounty(overrides: Partial<BountyState> = {}): BountyState {
  return {
    id: 0,
    poster: '0xposter',
    status: 'OPEN',
    submission_deadline: 1_000,
    evaluation_deadline: 2_000,
    submission_count: 0,
    has_winner: false,
    has_provisional_winner: false,
    provisional_submission_id: 0,
    refund_status: '',
    refund_amount: 0,
    escrow_balance: 0,
    challenge_window_seconds: 172800,
    ...overrides,
  }
}

function submission(overrides: Partial<SubmissionState> = {}): SubmissionState {
  return {
    id: 0,
    bounty_id: 0,
    creator: '0xcreator',
    status: 'PENDING',
    attempt_count: 0,
    challenge_deadline: 1_500,
    active_challenge_id: 0,
    reward_claimed: false,
    reward_status: '',
    reward_amount: 0,
    ...overrides,
  }
}

function challenge(overrides: Partial<ChallengeState> = {}): ChallengeState {
  return {
    id: 1,
    status: 'OPEN',
    review_deadline: 1_500,
    attempt_count: 0,
    proposed_outcome: '',
    bond: 10,
    bond_status: 'ESCROWED',
    bond_recipient: '0x0000000000000000000000000000000000000000',
    ...overrides,
  }
}

describe('contract vocabulary', () => {
  it('matches the status constants declared in the contract source', () => {
    const constants = contractConstants()
    expect([...BOUNTY_STATUSES].sort()).toEqual(
      [
        constants.BOUNTY_OPEN,
        constants.BOUNTY_LOCKED,
        constants.BOUNTY_FILLED,
        constants.BOUNTY_CANCELLED,
        constants.BOUNTY_EXPIRED,
      ].sort(),
    )
    expect([...SUBMISSION_STATUSES].sort()).toEqual(
      [
        constants.SUBMISSION_PENDING,
        constants.SUBMISSION_APPROVED_PENDING,
        constants.SUBMISSION_APPROVED,
        constants.SUBMISSION_REJECTED,
        constants.SUBMISSION_INCONCLUSIVE,
        constants.SUBMISSION_SUPERSEDED,
      ].sort(),
    )
    expect([...CHALLENGE_STATUSES].sort()).toEqual(
      [
        constants.CHALLENGE_OPEN,
        constants.CHALLENGE_UPHELD,
        constants.CHALLENGE_DISMISSED,
        constants.CHALLENGE_TIMED_OUT,
      ].sort(),
    )
    expect([...LIABILITY_STATUSES].sort()).toEqual(
      [constants.LIABILITY_NONE, constants.LIABILITY_PENDING, constants.LIABILITY_WITHDRAWN].sort(),
    )
    expect([...VERDICT_CODES].sort()).toEqual(
      [
        constants.VERDICT_ALL_CRITERIA_MET,
        constants.VERDICT_NOT_ALL_CRITERIA_MET,
        constants.VERDICT_EVIDENCE_UNVERIFIED,
        constants.VERDICT_CLAIM_TAG_MISSING,
        constants.VERDICT_CHALLENGE_UPHELD,
        '',
      ].sort(),
    )
  })
})

describe('availableActions', () => {
  it('offers nothing without a selected bounty', () => {
    const set = availableActions({ now: 0, wallet: null, bounty: null, submissions: [], challenges: [] })
    expect(set.bounty).toEqual([])
    expect(set.submission).toEqual({})
    expect(set.challenge).toEqual({})
  })

  it('offers submission only inside the window and only once per creator', () => {
    const set = availableActions({
      now: 500,
      wallet: '0xcreator',
      bounty: bounty(),
      submissions: [],
      challenges: [],
    })
    expect(set.bounty).toContain('submit')

    const afterDeadline = availableActions({
      now: 1_001,
      wallet: '0xcreator',
      bounty: bounty(),
      submissions: [],
      challenges: [],
    })
    expect(afterDeadline.bounty).not.toContain('submit')

    const alreadySubmitted = availableActions({
      now: 500,
      wallet: '0xcreator',
      bounty: bounty({ submission_count: 1 }),
      submissions: [submission({ creator: '0xcreator' })],
      challenges: [],
    })
    expect(alreadySubmitted.bounty).not.toContain('submit')

    const otherCreator = availableActions({
      now: 500,
      wallet: '0xsomeoneelse',
      bounty: bounty({ submission_count: 1 }),
      submissions: [submission({ creator: '0xcreator' })],
      challenges: [],
    })
    expect(otherCreator.bounty).toContain('submit')
  })

  it('does not offer expiry while a challenge is active', () => {
    const withChallenge = availableActions({
      now: 3_000,
      wallet: null,
      bounty: bounty({ status: 'LOCKED', evaluation_deadline: 2_000 }),
      submissions: [submission({ active_challenge_id: 1 })],
      challenges: [],
    })
    expect(withChallenge.bounty).not.toContain('expire')

    const withoutChallenge = availableActions({
      now: 3_000,
      wallet: null,
      bounty: bounty({ status: 'LOCKED', evaluation_deadline: 2_000 }),
      submissions: [submission({ active_challenge_id: 0 })],
      challenges: [],
    })
    expect(withoutChallenge.bounty).toContain('expire')
  })

  it('offers cancel only to the poster on an untouched bounty', () => {
    const set = availableActions({
      now: 100,
      wallet: '0xposter',
      bounty: bounty(),
      submissions: [],
      challenges: [],
    })
    expect(set.bounty).toContain('cancel')

    const notPoster = availableActions({
      now: 100,
      wallet: '0xother',
      bounty: bounty(),
      submissions: [],
      challenges: [],
    })
    expect(notPoster.bounty).not.toContain('cancel')

    const withSubmission = availableActions({
      now: 100,
      wallet: '0xposter',
      bounty: bounty({ submission_count: 1 }),
      submissions: [submission()],
      challenges: [],
    })
    expect(withSubmission.bounty).not.toContain('cancel')
  })

  it('offers evaluation only for an evaluable submission', () => {
    const set = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty({ status: 'LOCKED' }),
      submissions: [submission({ status: 'PENDING' })],
      challenges: [],
    })
    expect(set.submission[0]).toContain('evaluate')

    const exhausted = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty({ status: 'LOCKED' }),
      submissions: [submission({ status: 'INCONCLUSIVE', attempt_count: 3 })],
      challenges: [],
    })
    expect(exhausted.submission[0]).not.toContain('evaluate')

    const terminal = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty({ status: 'LOCKED' }),
      submissions: [submission({ status: 'REJECTED' })],
      challenges: [],
    })
    expect(terminal.submission[0]).not.toContain('evaluate')
  })

  it('does not offer evaluation when another submission holds the provisional win', () => {
    const set = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty({
        status: 'LOCKED',
        has_provisional_winner: true,
        provisional_submission_id: 9,
      }),
      submissions: [submission({ id: 0, status: 'PENDING' })],
      challenges: [],
    })
    expect(set.submission[0]).not.toContain('evaluate')
  })

  it('offers a challenge to anyone but the creator inside the dispute window', () => {
    const challenger = availableActions({
      now: 100,
      wallet: '0xchallenger',
      bounty: bounty({ status: 'LOCKED' }),
      submissions: [submission({ status: 'APPROVED_PENDING' })],
      challenges: [],
    })
    expect(challenger.submission[0]).toContain('challenge')

    const creator = availableActions({
      now: 100,
      wallet: '0xcreator',
      bounty: bounty({ status: 'LOCKED' }),
      submissions: [submission({ status: 'APPROVED_PENDING' })],
      challenges: [],
    })
    expect(creator.submission[0]).not.toContain('challenge')

    const afterWindow = availableActions({
      now: 1_500,
      wallet: '0xchallenger',
      bounty: bounty({ status: 'LOCKED' }),
      submissions: [submission({ status: 'APPROVED_PENDING' })],
      challenges: [],
    })
    expect(afterWindow.submission[0]).not.toContain('challenge')
  })

  it('offers a claim only to the creator after the dispute window', () => {
    const before = availableActions({
      now: 1_499,
      wallet: '0xcreator',
      bounty: bounty({
        status: 'LOCKED',
        has_provisional_winner: true,
        provisional_submission_id: 0,
      }),
      submissions: [submission({ status: 'APPROVED_PENDING' })],
      challenges: [],
    })
    expect(before.submission[0]).not.toContain('claim')

    const after = availableActions({
      now: 1_500,
      wallet: '0xcreator',
      bounty: bounty({
        status: 'LOCKED',
        has_provisional_winner: true,
        provisional_submission_id: 0,
      }),
      submissions: [submission({ status: 'APPROVED_PENDING' })],
      challenges: [],
    })
    expect(after.submission[0]).toContain('claim')

    const stranger = availableActions({
      now: 1_500,
      wallet: '0xother',
      bounty: bounty({
        status: 'LOCKED',
        has_provisional_winner: true,
        provisional_submission_id: 0,
      }),
      submissions: [submission({ status: 'APPROVED_PENDING' })],
      challenges: [],
    })
    expect(stranger.submission[0]).not.toContain('claim')
  })

  it('offers a withdrawal only to the recorded recipient', () => {
    const set = availableActions({
      now: 2_000,
      wallet: '0xcreator',
      bounty: bounty({ status: 'FILLED' }),
      submissions: [
        submission({ status: 'APPROVED', reward_status: 'PENDING', reward_amount: 100 }),
      ],
      challenges: [],
    })
    expect(set.submission[0]).toContain('withdraw_reward')

    const stranger = availableActions({
      now: 2_000,
      wallet: '0xother',
      bounty: bounty({ status: 'FILLED' }),
      submissions: [
        submission({ status: 'APPROVED', reward_status: 'PENDING', reward_amount: 100 }),
      ],
      challenges: [],
    })
    expect(stranger.submission[0]).not.toContain('withdraw_reward')

    const alreadyWithdrawn = availableActions({
      now: 2_000,
      wallet: '0xcreator',
      bounty: bounty({ status: 'FILLED' }),
      submissions: [
        submission({ status: 'APPROVED', reward_status: 'WITHDRAWN', reward_amount: 100 }),
      ],
      challenges: [],
    })
    expect(alreadyWithdrawn.submission[0]).not.toContain('withdraw_reward')
  })

  it('offers a refund withdrawal only to the poster', () => {
    const poster = availableActions({
      now: 2_000,
      wallet: '0xposter',
      bounty: bounty({ status: 'CANCELLED', refund_status: 'PENDING', refund_amount: 100 }),
      submissions: [],
      challenges: [],
    })
    expect(poster.bounty).toContain('withdraw_refund')

    const other = availableActions({
      now: 2_000,
      wallet: '0xother',
      bounty: bounty({ status: 'CANCELLED', refund_status: 'PENDING', refund_amount: 100 }),
      submissions: [],
      challenges: [],
    })
    expect(other.bounty).not.toContain('withdraw_refund')
  })

  it('offers challenge resolution only in the states the contract accepts', () => {
    const open = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty(),
      submissions: [],
      challenges: [challenge()],
    })
    expect(open.challenge[1]).toEqual(['review'])

    const proposed = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty(),
      submissions: [],
      challenges: [challenge({ proposed_outcome: 'UPHOLD' })],
    })
    expect(proposed.challenge[1]).toEqual(['finalize'])

    const inconclusive = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty(),
      submissions: [],
      challenges: [challenge({ proposed_outcome: 'INCONCLUSIVE' })],
    })
    expect(inconclusive.challenge[1]).toEqual(['review'])

    const exhausted = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty(),
      submissions: [],
      challenges: [challenge({ attempt_count: 3 })],
    })
    expect(exhausted.challenge[1]).toEqual(['timeout'])

    const elapsed = availableActions({
      now: 1_500,
      wallet: null,
      bounty: bounty(),
      submissions: [],
      challenges: [challenge()],
    })
    expect(elapsed.challenge[1]).toEqual(['timeout'])

    const settled = availableActions({
      now: 100,
      wallet: null,
      bounty: bounty(),
      submissions: [],
      challenges: [challenge({ status: 'UPHELD' })],
    })
    expect(settled.challenge[1]).toEqual([])
  })

  it('offers a bond withdrawal only to the recorded bond recipient', () => {
    const set = availableActions({
      now: 2_000,
      wallet: '0xchallenger',
      bounty: bounty(),
      submissions: [],
      challenges: [challenge({ bond_status: 'PENDING', bond_recipient: '0xchallenger' })],
    })
    expect(set.challenge[1]).toContain('withdraw_bond')

    const other = availableActions({
      now: 2_000,
      wallet: '0xother',
      bounty: bounty(),
      submissions: [],
      challenges: [challenge({ bond_status: 'PENDING', bond_recipient: '0xchallenger' })],
    })
    expect(other.challenge[1]).not.toContain('withdraw_bond')
  })
})

describe('sameAddress', () => {
  it('compares addresses case-insensitively and rejects missing values', () => {
    expect(sameAddress('0xAbC', '0xabc')).toBe(true)
    expect(sameAddress('0xabc', '0xabd')).toBe(false)
    expect(sameAddress(null, '0xabc')).toBe(false)
    expect(sameAddress('0xabc', undefined)).toBe(false)
  })
})
