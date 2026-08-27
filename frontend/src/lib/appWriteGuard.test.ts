import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

describe('App wallet write guard', () => {
  it('routes the only SDK writeContract call through runVerifiedWalletWrite', () => {
    expect(appSource.match(/\bwriteContract\s*\(/g)).toHaveLength(1)
    expect(appSource).toMatch(
      /runVerifiedWalletWrite\s*\(\s*\{[\s\S]*?write:\s*\(\)\s*=>\s*client\.writeContract\s*\(/,
    )
  })

  it.each([
    'postBounty',
    'submitEvidence',
    'evaluateSubmission',
    'submitChallenge',
    'reviewChallenge',
    'finalizeChallenge',
    'timeoutChallenge',
    'claimReward',
    'cancelBounty',
    'expireBounty',
  ])('%s delegates its transaction through runWrite', (functionName) => {
    const match = appSource.match(new RegExp(`async function ${functionName}\\([^]*?\\n}`))
    expect(match?.[0]).toContain('runWrite(')
    expect(match?.[0]).not.toContain('writeContract(')
  })

  it('tracks every delayed-settlement transaction action', () => {
    for (const action of [
      'CHALLENGE',
      'REVIEW_CHALLENGE',
      'FINALIZE_CHALLENGE',
      'TIMEOUT_CHALLENGE',
      'CLAIM',
    ]) {
      expect(appSource).toContain(`'${action}'`)
    }
  })

  it('renders challenge bonds without truncating valid wei precision', () => {
    expect(appSource).toContain('formatWei(challengeBond, 18)')
    expect(appSource).toContain('formatWei(challengeFor(submission)?.bond || 0, 18)')
  })

  it('discards stale claim-tag reads after the wallet or bounty changes', () => {
    expect(appSource).toContain('const requestId = ++claimTagRequestId')
    expect(appSource).toContain('requestId !== claimTagRequestId')
    expect(appSource).toContain('walletAddress.value !== creatorAddress')
    expect(appSource).toContain('selectedBounty.value?.id !== bountyId')
  })

  it('retains challenge records loaded for other frontend views', () => {
    expect(appSource).toContain('challenges.value = { ...challenges.value, ...loadedChallenges }')
  })

  it('refreshes selected bounty state when returning from wallet activity', () => {
    const match = appSource.match(/async function openBountiesView\(\)[^]*?\n}/)
    expect(match?.[0]).toContain("activeView.value = 'bounties'")
    expect(match?.[0]).toContain('await refreshSelected()')
    expect(appSource).toContain('@click="openSubmissionBounty(submission)"')
  })

  it('surfaces an agreed inconclusive challenge review without implying settlement', () => {
    expect(appSource).toContain("updated?.proposed_outcome === 'INCONCLUSIVE'")
    expect(appSource).toContain('Challenge review was inconclusive')
  })
})
