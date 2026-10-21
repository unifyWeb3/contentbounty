import type { VerdictCode } from './statusActions'

export interface VerdictCriterion {
  id: string
  requirement: string
  met: boolean
}

export interface VerdictRecord {
  status: string
  verdict_code: VerdictCode
  decision: string
  criteria_bits: string
  score_bucket: number
  reason_code: string
  rubric_sha256: string
  evidence_sha256: string
  criteria_json: string
}

export type VerdictTone = 'positive' | 'negative' | 'caution' | 'neutral'

export interface VerdictView {
  headline: string
  detail: string
  tone: VerdictTone
  criteria: VerdictCriterion[]
}

const REASON_TEXT: Record<string, string> = {
  ALL_REQUIRED_CRITERIA_MET: 'Every rubric criterion is evidenced by the rendered source.',
  CRITERIA_NOT_MET: 'At least one rubric criterion is not evidenced by the rendered source.',
  CLAIM_TAG_MISSING: 'The wallet claim tag is absent from the rendered source, so no rubric was judged.',
  DIGEST_MISMATCH: 'The rendered source no longer matches the committed digest.',
  FETCH_FAILED: 'The evidence source could not be rendered.',
  EMPTY_EVIDENCE: 'The rendered source contained no readable text.',
  EVIDENCE_TOO_LARGE: 'The rendered source exceeds the documented size limit.',
  EXTRACTION_FAILED: 'The evaluator could not extract bounded observations.',
  JUDGMENT_FAILED: 'The evaluator could not produce a bounded criterion judgment.',
  INVALID_JUDGMENT: 'The evaluator returned an unusable criterion judgment.',
}

/**
 * Turn the closed-set verdict stored by the contract into readable copy.
 *
 * Every string produced here is derived from a value the validators agreed on
 * or from deterministic contract code. Nothing is read from model output,
 * because the contract does not store any.
 */
export function describeVerdict(verdict: VerdictRecord): VerdictView {
  let criteria: VerdictCriterion[] = []
  try {
    const parsed = JSON.parse(verdict.criteria_json || '[]')
    if (Array.isArray(parsed)) {
      criteria = parsed.filter(
        (row): row is VerdictCriterion =>
          Boolean(row) && typeof row.id === 'string' && typeof row.met === 'boolean',
      )
    }
  } catch {
    criteria = []
  }

  const metCount = criteria.filter((row) => row.met).length
  const reasonText = REASON_TEXT[verdict.reason_code] ?? ''

  if (verdict.verdict_code === 'ALL_CRITERIA_MET') {
    return {
      headline: 'All criteria met',
      detail: `${metCount} of ${criteria.length} criteria are evidenced by the source the validators rendered.`,
      tone: 'positive',
      criteria,
    }
  }

  if (verdict.verdict_code === 'NOT_ALL_CRITERIA_MET') {
    return {
      headline: 'Not all criteria met',
      detail: `${metCount} of ${criteria.length} criteria are evidenced by the source the validators rendered.`,
      tone: 'negative',
      criteria,
    }
  }

  if (verdict.verdict_code === 'CLAIM_TAG_MISSING') {
    return {
      headline: 'Claim tag missing',
      detail: 'The rendered source does not carry the submitting wallet claim tag, so no rubric was judged.',
      tone: 'negative',
      criteria,
    }
  }

  if (verdict.verdict_code === 'CHALLENGE_UPHELD') {
    return {
      headline: 'Approval overturned by a challenge',
      detail: 'A second consensus round upheld a challenge against this submission, so the approval no longer stands.',
      tone: 'negative',
      criteria,
    }
  }

  if (verdict.verdict_code === 'EVIDENCE_UNVERIFIED') {
    return {
      headline: 'Evidence unverified',
      detail: reasonText || 'The evidence could not be verified against the rubric, so the submission stays retryable.',
      tone: 'caution',
      criteria,
    }
  }

  if (!verdict.verdict_code) {
    return {
      headline: 'Not evaluated',
      detail: 'No consensus evaluation has been recorded for this submission yet.',
      tone: 'neutral',
      criteria,
    }
  }

  return {
    headline: verdict.reason_code || 'Undetermined',
    detail: reasonText,
    tone: 'caution',
    criteria,
  }
}
