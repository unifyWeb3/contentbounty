import { describe, expect, it } from 'vitest'
import { contractErrorMessage, formatCountdown, validateSourceUri } from './provenance'

const allowed = [
  'github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'mirror.xyz',
  'hackmd.io',
  'medium.com',
  'substack.com',
]

describe('source allowlist validation', () => {
  it.each([
    'https://github.com/org/repo',
    'https://raw.githubusercontent.com/org/repo/main/post.txt',
    'https://gist.github.com/user/id',
    'https://mirror.xyz/example.eth/post',
    'https://hackmd.io/example',
    'https://medium.com/@author/post',
    'https://substack.com/home/post/p-example',
    'https://author.substack.com/p/example',
  ])('accepts %s', (uri) => {
    expect(validateSourceUri(uri, allowed)).toBeNull()
  })

  it.each([
    'http://github.com/org/repo',
    'https://user:pass@github.com/org/repo',
    'https://github.com/org/repo#fragment',
    'https://github.com.evil.example/org/repo',
    'https://evil.example/github.com/org/repo',
    'https://GitHub.com/org/repo',
    'https://github.com:443/org/repo',
    ' https://github.com/org/repo',
    'https://github.com/org/repo ',
  ])('rejects %s', (uri) => {
    expect(validateSourceUri(uri, allowed)).not.toBeNull()
  })
})

describe('challenge presentation helpers', () => {
  it('formats a bounded live countdown', () => {
    expect(formatCountdown(100_000, 10_000)).toBe('1d 1h 0m')
    expect(formatCountdown(10, 10)).toBe('Window elapsed')
  })

  it('maps contract failures to explicit user-facing errors', () => {
    expect(contractErrorMessage(new Error('CLAIM_TAG_MISSING'))).toMatch(/claim tag/i)
    expect(contractErrorMessage(new Error('Incorrect challenge bond'))).toMatch(/exact challenge bond/i)
    expect(contractErrorMessage(new Error('Active challenge blocks reward claim'))).toMatch(/resolve or time out/i)
    expect(contractErrorMessage(new Error('Only the creator can claim'))).toMatch(/submission creator/i)
    expect(contractErrorMessage(new Error('Bounty is not locked for settlement'))).toMatch(/claim is blocked/i)
    expect(contractErrorMessage(new Error('Submission is not the provisional winner'))).toMatch(/claim is blocked/i)
    expect(contractErrorMessage(new Error('Bounty has a provisional winner'))).toMatch(/awaiting.*settlement/i)
    expect(contractErrorMessage(new Error('Challenge timeout is not available'))).toMatch(/three agreed inconclusive/i)
    expect(contractErrorMessage(new Error('Challenge review deadline elapsed'))).toMatch(/timeout action/i)
    expect(contractErrorMessage(new Error('No final challenge proposal'))).toMatch(/review.*before finalizing/i)
  })
})
