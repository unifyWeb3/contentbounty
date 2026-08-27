export const CHALLENGE_REASONS = [
  { value: 'NO_SOURCE_CONTROL', label: 'No source control' },
  { value: 'AUTHORSHIP_DISPUTE', label: 'Authorship dispute' },
  { value: 'RIGHTS_OR_PLAGIARISM', label: 'Rights or plagiarism' },
  { value: 'FALSE_OR_MISLEADING_CLAIM', label: 'False or misleading claim' },
  { value: 'SOURCE_TAMPERED', label: 'Source tampered' },
  { value: 'RUBRIC_EVALUATION_ERROR', label: 'Rubric evaluation error' },
] as const

export type ChallengeReason = typeof CHALLENGE_REASONS[number]['value']

export function validateSourceUri(uri: string, allowedSources: string[]): string | null {
  if (!uri) return 'A source URI is required.'
  if ([...uri].some((character) => /\s/.test(character))) return 'The source URI cannot contain whitespace.'
  if (!uri.startsWith('https://')) return 'The source must use canonical HTTPS.'
  if (uri.includes('#')) return 'URL fragments are not supported.'

  const authorityAndPath = uri.slice('https://'.length)
  const slashIndex = authorityAndPath.indexOf('/')
  const authority = slashIndex < 0 ? authorityAndPath : authorityAndPath.slice(0, slashIndex)
  if (!authority) return 'The source URI must include a host.'
  if (authority.includes('@')) return 'Credential-bearing source URIs are not supported.'
  if (authority !== authority.toLowerCase()) return 'The source host must be lowercase.'
  if (authority.includes(':')) return 'Only the canonical HTTPS port is supported.'
  if (authority.startsWith('.') || authority.endsWith('.') || authority.includes('..')) {
    return 'The source host is ambiguous.'
  }

  const labels = authority.split('.')
  if (labels.some((label) => !label || label.startsWith('-') || label.endsWith('-') || !/^[a-z0-9-]+$/.test(label))) {
    return 'The source host is invalid.'
  }

  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hostname !== authority) {
      return 'The source URI is not in canonical HTTPS form.'
    }
  } catch {
    return 'The source URI is invalid.'
  }

  const allowed = allowedSources.includes(authority)
    || (allowedSources.includes('substack.com') && authority.endsWith('.substack.com'))
  if (!allowed) return `The source host ${authority} is not supported.`
  return null
}

export function formatCountdown(deadline: number, now: number): string {
  const remaining = Math.max(0, Math.floor(deadline - now))
  if (remaining === 0) return 'Window elapsed'
  const days = Math.floor(remaining / 86_400)
  const hours = Math.floor((remaining % 86_400) / 3_600)
  const minutes = Math.floor((remaining % 3_600) / 60)
  const seconds = remaining % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${seconds}s`
}

export function contractErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const normalized = raw.toLowerCase()
  if (normalized.includes('claim_tag_missing')) {
    return 'The rendered source does not contain the exact wallet claim tag. Add it before submitting.'
  }
  if (normalized.includes('source host is not allowed') || normalized.includes('source host') && normalized.includes('not supported')) {
    return 'This source host is not supported by the contract allowlist.'
  }
  if (normalized.includes('challenge review deadline elapsed')) {
    return 'The challenge review window has elapsed. Use the timeout action.'
  }
  if (normalized.includes('challenge deadline elapsed')) return 'The challenge window has already elapsed.'
  if (normalized.includes('active challenge blocks reward claim')) {
    return 'Resolve or time out the active challenge before claiming.'
  }
  if (normalized.includes('active challenge') || normalized.includes('already has an active challenge')) {
    return 'An active challenge currently blocks this action.'
  }
  if (normalized.includes('duplicate challenge')) return 'This challenge evidence and reason were already submitted.'
  if (normalized.includes('incorrect challenge bond')) return 'The transaction must send the exact challenge bond shown.'
  if (normalized.includes('challenge review attempts exhausted') || normalized.includes('inconclusive')) {
    return 'The challenge review is inconclusive. Use the timeout action when its attempt or time condition is met.'
  }
  if (normalized.includes('challenge deadline has not elapsed')) return 'The reward cannot be claimed before the challenge deadline.'
  if (normalized.includes('only the creator can claim')) return 'Only the submission creator can claim this reward.'
  if (normalized.includes('reward already claimed')) return 'This reward has already been claimed.'
  if (normalized.includes('submission is not claimable')) return 'This submission is not eligible for reward claim.'
  if (
    normalized.includes('bounty is not locked for settlement')
    || normalized.includes('submission is not the provisional winner')
  ) {
    return 'The reward claim is blocked because this bounty is not locked to the selected provisional submission.'
  }
  if (normalized.includes('bounty has a provisional winner')) {
    return 'Another submission is awaiting challenge-window settlement for this bounty.'
  }
  if (normalized.includes('creator cannot challenge own submission')) {
    return 'The submission creator cannot challenge their own submission.'
  }
  if (normalized.includes('challenge timeout is not available')) {
    return 'This challenge cannot time out until three agreed inconclusive reviews or the review deadline.'
  }
  if (normalized.includes('no final challenge proposal')) {
    return 'Review the challenge to an agreed uphold or dismiss proposal before finalizing it.'
  }
  if (normalized.includes('digest_mismatch') || normalized.includes('source changed') || normalized.includes('source mutated')) {
    return 'The rendered source no longer matches its committed digest.'
  }
  return raw
}
