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
    'cancelBounty',
    'expireBounty',
  ])('%s delegates its transaction through runWrite', (functionName) => {
    const match = appSource.match(new RegExp(`async function ${functionName}\\([^]*?\\n}`))
    expect(match?.[0]).toContain('runWrite(')
    expect(match?.[0]).not.toContain('writeContract(')
  })
})
