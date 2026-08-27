<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { createClient } from 'genlayer-js'
import { TransactionStatus } from 'genlayer-js/types'
import {
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  NETWORK,
  NETWORK_LABEL,
  NETWORK_SELECTOR,
  RPC_URL,
  walletChainParameters,
} from './lib/genlayer'
import {
  classifyTransaction,
  isVerifiedSuccessfulFinalization,
  type TransactionClassification,
  type TransactionPhase,
} from './lib/transactionClassifier'
import {
  runVerifiedWalletWrite,
  verifyInjectedWalletNetwork,
  type EthereumProvider,
} from './lib/walletNetwork'
import {
  CHALLENGE_REASONS,
  contractErrorMessage,
  formatCountdown,
  validateSourceUri,
  type ChallengeReason,
} from './lib/provenance'

type Address = `0x${string}`

interface Bounty {
  id: number
  poster: string
  title: string
  description: string
  rubric_json: string
  rubric_version: string
  reward: number | string | bigint
  created_at: number
  submission_deadline: number
  evaluation_deadline: number
  status: 'OPEN' | 'LOCKED' | 'FILLED' | 'CANCELLED' | 'EXPIRED'
  submission_count: number
  has_winner: boolean
  winner_submission_id: number
  has_provisional_winner: boolean
  provisional_submission_id: number
}

interface Submission {
  id: number
  bounty_id: number
  creator: string
  evidence_uri: string
  evidence_sha256: string
  status: 'PENDING' | 'APPROVED_PENDING' | 'APPROVED' | 'REJECTED' | 'INCONCLUSIVE' | 'SUPERSEDED'
  attempt_count: number
  submitted_at: number
  evaluated_at: number
  decision: '' | 'APPROVE' | 'REJECT' | 'INCONCLUSIVE'
  criteria_bits: string
  score_bucket: number
  reason_code: string
  feedback: string
  rubric_version: string
  evaluator_version: string
  claim_tag: string
  claim_tag_version: string
  approved_at: number
  challenge_deadline: number
  active_challenge_id: number
  latest_challenge_id: number
  reward_claimed: boolean
}

interface Challenge {
  id: number
  submission_id: number
  bounty_id: number
  challenger: string
  reason_code: ChallengeReason
  evidence_uri: string
  evidence_sha256: string
  bond: number | string | bigint
  status: 'OPEN' | 'UPHELD' | 'DISMISSED' | 'TIMED_OUT'
  created_at: number
  review_deadline: number
  attempt_count: number
  proposed_outcome: '' | 'UPHOLD' | 'DISMISS' | 'INCONCLUSIVE'
  proposed_reason_code: string
  proposed_error_class: string
  proposed_feedback: string
  reviewed_at: number
  finalized_at: number
  bond_released: boolean
  bond_recipient: string
  bond_disposition: string
}

interface CriterionDraft {
  id: string
  requirement: string
}

interface TxEvidence {
  hash: string
  action: 'POST' | 'SUBMIT' | 'EVALUATE' | 'CANCEL' | 'EXPIRE' | 'CHALLENGE' | 'REVIEW_CHALLENGE' | 'FINALIZE_CHALLENGE' | 'TIMEOUT_CHALLENGE' | 'CLAIM'
  entityId?: number
  label: string
  submittedAt: number
  phase: TransactionPhase
  statusName?: string
  resultName?: string
  executionResultName?: string
  failureReason?: string
  error?: string
}

const TX_STORAGE_KEY = 'contentbounty:v2:transactions'
type InjectedEthereumProvider = EthereumProvider & {
  on?(event: string, listener: (...args: any[]) => void): void
  removeListener?(event: string, listener: (...args: any[]) => void): void
}

const provider = computed<InjectedEthereumProvider | undefined>(() => (window as any).ethereum)
const readClient = createClient({ chain: NETWORK }) as any

const activeView = ref<'bounties' | 'post' | 'activity' | 'transactions'>('bounties')
const walletAddress = ref<Address | ''>('')
const walletError = ref('')
const loading = ref(false)
const actionBusy = ref('')
const notice = ref<{ type: 'info' | 'success' | 'error'; message: string } | null>(null)
const bounties = ref<Bounty[]>([])
const selectedBounty = ref<Bounty | null>(null)
const submissions = ref<Submission[]>([])
const activitySubmissions = ref<Submission[]>([])
const transactions = ref<TxEvidence[]>(loadTransactions())
const allowedSources = ref<string[]>([])
const claimTag = ref('')
const claimTagLoading = ref(false)
const challenges = ref<Record<number, Challenge>>({})
const challengeTarget = ref<Submission | null>(null)
const challengeBond = ref(0n)
const nowSeconds = ref(Math.floor(Date.now() / 1000))
let clockHandle: number | undefined
let claimTagRequestId = 0

const postForm = ref({
  title: '',
  description: '',
  reward: '',
  submissionDays: '7',
  evaluationDays: '3',
  criteria: [
    { id: 'c1', requirement: '' },
    { id: 'c2', requirement: '' },
  ] as CriterionDraft[],
})

const submitForm = ref({ evidenceUri: '' })
const challengeForm = ref({
  reasonCode: 'RIGHTS_OR_PLAGIARISM' as ChallengeReason,
  evidenceUri: '',
  confirmed: false,
})

const connected = computed(() => Boolean(walletAddress.value))
const contractConfigured = computed(() => /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS))
const mySubmissions = computed(() => {
  if (!walletAddress.value) return []
  const address = walletAddress.value.toLowerCase()
  return activitySubmissions.value.filter((submission) => submission.creator.toLowerCase() === address)
})
const openBounties = computed(() => bounties.value.filter((bounty) => ['OPEN', 'LOCKED'].includes(bounty.status)).length)
const lockedValue = computed(() => bounties.value
  .filter((bounty) => ['OPEN', 'LOCKED'].includes(bounty.status))
  .reduce((sum, bounty) => sum + BigInt(bounty.reward), 0n))
const verifiedFinalizedTransactions = computed(() => transactions.value.filter((entry) =>
  isVerifiedSuccessfulFinalization({
    statusName: entry.statusName,
    resultName: entry.resultName,
    txExecutionResultName: entry.executionResultName,
  }),
).length)
const submitUriError = computed(() => {
  const uri = submitForm.value.evidenceUri
  return uri ? validateSourceUri(uri, allowedSources.value) : null
})
const supportedSourceLabels = computed(() => allowedSources.value.map((host) => (
  host === 'substack.com' ? 'substack.com + subdomains' : host
)))

function loadTransactions(): TxEvidence[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TX_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 30) : []
  } catch {
    return []
  }
}

function persistTransactions() {
  localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(transactions.value.slice(0, 30)))
}

function upsertTransaction(entry: TxEvidence) {
  const index = transactions.value.findIndex((item) => item.hash === entry.hash)
  if (index >= 0) transactions.value[index] = entry
  else transactions.value.unshift(entry)
  persistTransactions()
}

function patchTransaction(hash: string, patch: Partial<TxEvidence>) {
  const current = transactions.value.find((item) => item.hash === hash)
  if (!current) return
  upsertTransaction({ ...current, ...patch })
}

function applyTransactionClassification(hash: string, classification: TransactionClassification) {
  patchTransaction(hash, {
    phase: classification.phase,
    statusName: classification.statusName,
    resultName: classification.resultName,
    executionResultName: classification.executionResultName,
    failureReason: classification.failureReason,
  })
}

function showNotice(message: string, type: 'info' | 'success' | 'error' = 'info') {
  notice.value = { message, type }
}

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''
}

function formatDate(timestamp: number) {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp * 1000)
}

function formatWei(value: number | string | bigint, precision = 4) {
  const wei = BigInt(value)
  const base = 10n ** 18n
  const whole = wei / base
  const fractional = (wei % base).toString().padStart(18, '0').slice(0, precision).replace(/0+$/, '')
  return fractional ? `${whole}.${fractional}` : whole.toString()
}

function parseGenAmount(value: string): bigint {
  const trimmed = value.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(trimmed)) {
    throw new Error('Reward must be a positive decimal with at most 18 fractional digits.')
  }
  const [whole, fraction = ''] = trimmed.split('.')
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
  if (wei <= 0n) throw new Error('Reward must be greater than zero.')
  return wei
}

function rubricFor(bounty: Bounty): CriterionDraft[] {
  try {
    const parsed = JSON.parse(bounty.rubric_json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function statusClass(status: string) {
  return `status status-${status.toLowerCase()}`
}

function challengeFor(submission: Submission) {
  return submission.latest_challenge_id ? challenges.value[submission.latest_challenge_id] : undefined
}

function isCreator(submission: Submission) {
  return Boolean(walletAddress.value) && submission.creator.toLowerCase() === walletAddress.value.toLowerCase()
}

function bountyForSubmission(submission: Submission) {
  return bounties.value.find((bounty) => bounty.id === submission.bounty_id)
}

function canEvaluate(submission: Submission) {
  if (!selectedBounty.value) return false
  return ['PENDING', 'INCONCLUSIVE'].includes(submission.status)
    && submission.attempt_count < 3
    && nowSeconds.value <= selectedBounty.value.evaluation_deadline
    && ['OPEN', 'LOCKED'].includes(selectedBounty.value.status)
    && (
      !selectedBounty.value.has_provisional_winner
      || selectedBounty.value.provisional_submission_id === submission.id
    )
}

function evaluationEvidence(submissionId: number) {
  return transactions.value.find((entry) => entry.action === 'EVALUATE' && entry.entityId === submissionId)
}

function claimEvidence(submissionId: number) {
  return transactions.value.find((entry) => entry.action === 'CLAIM' && entry.entityId === submissionId)
}

function settlementLabel(submission: Submission) {
  if (submission.status === 'APPROVED_PENDING') {
    return `Consensus approved this submission, but no creator reward has moved. Challenge window: ${formatCountdown(submission.challenge_deadline, nowSeconds.value)}.`
  }
  if (submission.status !== 'APPROVED') return ''
  const evidence = claimEvidence(submission.id)
  if (!evidence) return 'The submission state is APPROVED. This browser has no local claim transaction evidence; verify finalization and the recipient balance independently.'
  const classification = classifyTransaction({
    statusName: evidence.statusName,
    resultName: evidence.resultName,
    txExecutionResultName: evidence.executionResultName,
  })
  if (classification.phase === 'FINALIZED') return 'Reward claim finalized successfully. Confirm the creator balance delta before describing the reward as paid.'
  if (classification.phase === 'ACCEPTED') return 'Reward claim reached consensus but is not finalized yet.'
  if (classification.phase === 'FAILED') return `The recorded claim transaction failed: ${classification.failureReason ?? 'unknown failure'}.`
  return 'Reward claim was submitted and remains unconfirmed.'
}

function sourceStateLabel(submission: Submission) {
  if (submission.reason_code === 'CLAIM_TAG_MISSING') return 'The required wallet claim tag is absent from the current rendered source.'
  if (submission.reason_code === 'DIGEST_MISMATCH') return 'The current rendered source no longer matches the submitted digest.'
  return ''
}

function canChallenge(submission: Submission) {
  return submission.status === 'APPROVED_PENDING'
    && submission.active_challenge_id === 0
    && nowSeconds.value < submission.challenge_deadline
    && (!walletAddress.value || !isCreator(submission))
}

function canReviewChallenge(challenge: Challenge) {
  return challenge.status === 'OPEN'
    && nowSeconds.value < challenge.review_deadline
    && challenge.attempt_count < 3
    && ['', 'INCONCLUSIVE'].includes(challenge.proposed_outcome)
}

function canFinalizeChallenge(challenge: Challenge) {
  return challenge.status === 'OPEN' && ['UPHOLD', 'DISMISS'].includes(challenge.proposed_outcome)
}

function canTimeoutChallenge(challenge: Challenge) {
  return challenge.status === 'OPEN'
    && ['', 'INCONCLUSIVE'].includes(challenge.proposed_outcome)
    && (challenge.attempt_count >= 3 || nowSeconds.value >= challenge.review_deadline)
}

function canReviewSubmissionChallenge(submission: Submission) {
  const challenge = challengeFor(submission)
  return Boolean(challenge && canReviewChallenge(challenge))
}

function canFinalizeSubmissionChallenge(submission: Submission) {
  const challenge = challengeFor(submission)
  return Boolean(challenge && canFinalizeChallenge(challenge))
}

function canTimeoutSubmissionChallenge(submission: Submission) {
  const challenge = challengeFor(submission)
  return Boolean(challenge && canTimeoutChallenge(challenge))
}

function reviewSubmissionChallenge(submission: Submission) {
  const challenge = challengeFor(submission)
  if (challenge) void reviewChallenge(challenge)
}

function finalizeSubmissionChallenge(submission: Submission) {
  const challenge = challengeFor(submission)
  if (challenge) void finalizeChallenge(challenge)
}

function timeoutSubmissionChallenge(submission: Submission) {
  const challenge = challengeFor(submission)
  if (challenge) void timeoutChallenge(challenge)
}

function canClaimReward(submission: Submission) {
  const bounty = bountyForSubmission(submission)
  return Boolean(bounty)
    && isCreator(submission)
    && submission.status === 'APPROVED_PENDING'
    && nowSeconds.value >= submission.challenge_deadline
    && submission.active_challenge_id === 0
    && !submission.reward_claimed
    && bounty?.status === 'LOCKED'
    && bounty.has_provisional_winner
    && bounty.provisional_submission_id === submission.id
}

function externalAccount(address: Address) {
  return { address, type: 'json-rpc' } as any
}

function writeClient() {
  if (!provider.value || !walletAddress.value) throw new Error('Connect an injected wallet first.')
  return createClient({
    chain: NETWORK,
    account: walletAddress.value as any,
    provider: provider.value as any,
  }) as any
}

async function selectWalletChain() {
  if (!provider.value) throw new Error('No injected wallet was found. Install a compatible wallet extension.')
  const expected = `0x${Number(NETWORK.id).toString(16)}`
  let current: unknown
  try {
    current = await provider.value.request({ method: 'eth_chainId' })
  } catch (error: any) {
    throw new Error(`Could not verify the wallet network before signing: ${error?.message ?? String(error)}. No transaction was sent.`)
  }
  if (String(current).toLowerCase() === expected.toLowerCase()) return
  try {
    await provider.value.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: expected }] })
  } catch (error: any) {
    if (error?.code !== 4902) throw error
    await provider.value.request({ method: 'wallet_addEthereumChain', params: [walletChainParameters] })
  }
}

async function ensureWalletNetwork() {
  await selectWalletChain()
  if (!provider.value) throw new Error('No injected wallet was found. Install a compatible wallet extension.')
  await verifyInjectedWalletNetwork(provider.value, NETWORK_SELECTOR, NETWORK)
}

async function connectWallet() {
  walletError.value = ''
  try {
    if (!provider.value) throw new Error('No injected wallet detected.')
    await ensureWalletNetwork()
    const accounts = await provider.value.request({ method: 'eth_requestAccounts' })
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error('The wallet returned no account.')
    walletAddress.value = accounts[0] as Address
    showNotice(`Connected ${shortAddress(walletAddress.value)}. Signing stays in your wallet.`, 'success')
    if (activeView.value === 'activity') await openActivity()
  } catch (error: any) {
    walletError.value = error?.message ?? String(error)
    showNotice(walletError.value, 'error')
  }
}

function disconnectWallet() {
  walletAddress.value = ''
  showNotice('Disconnected locally. The wallet extension remains locked or connected on its own terms.')
}

async function restoreWallet() {
  if (!provider.value) return
  try {
    const accounts = await provider.value.request({ method: 'eth_accounts' })
    if (Array.isArray(accounts) && accounts[0]) walletAddress.value = accounts[0] as Address
  } catch {
    // A read-only app remains usable when the provider rejects account discovery.
  }
}

async function readAllBounties() {
  const result: Bounty[] = []
  for (let offset = 0; ; offset += 50) {
    const page = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_bounties_page',
      args: [offset, 50],
    }) as Bounty[]
    result.push(...page)
    if (page.length < 50) return result
  }
}

async function loadAllowedSources() {
  if (!contractConfigured.value) return
  try {
    allowedSources.value = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_allowed_sources',
      args: [],
    }) as string[]
  } catch (error: any) {
    allowedSources.value = []
    showNotice(`Could not load the contract source policy: ${contractErrorMessage(error)}`, 'error')
  }
}

async function loadClaimTag() {
  const requestId = ++claimTagRequestId
  const bountyId = selectedBounty.value?.id
  const creatorAddress = walletAddress.value
  claimTag.value = ''
  if (!contractConfigured.value || !creatorAddress || bountyId === undefined) {
    claimTagLoading.value = false
    return
  }
  claimTagLoading.value = true
  try {
    const loadedTag = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_claim_tag',
      args: [bountyId, creatorAddress],
    }) as string
    if (
      requestId !== claimTagRequestId
      || walletAddress.value !== creatorAddress
      || selectedBounty.value?.id !== bountyId
    ) return
    claimTag.value = loadedTag
  } catch (error: any) {
    if (requestId === claimTagRequestId) {
      showNotice(`Could not derive the claim tag: ${contractErrorMessage(error)}`, 'error')
    }
  } finally {
    if (requestId === claimTagRequestId) claimTagLoading.value = false
  }
}

async function copyClaimTag() {
  if (!claimTag.value) return
  try {
    await navigator.clipboard.writeText(claimTag.value)
    showNotice('Claim tag copied.', 'success')
  } catch {
    showNotice('Clipboard access failed. Select the claim tag manually.', 'error')
  }
}

async function loadChallengeDetails(records: Submission[]) {
  const ids = [...new Set(records.map((submission) => submission.latest_challenge_id).filter((id) => id > 0))]
  const loaded = await Promise.all(ids.map(async (id) => {
    try {
      const challenge = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: 'get_challenge',
        args: [id],
      }) as Challenge
      return [id, challenge] as const
    } catch {
      return null
    }
  }))
  const loadedChallenges = Object.fromEntries(
    loaded.filter((entry): entry is readonly [number, Challenge] => entry !== null),
  )
  challenges.value = { ...challenges.value, ...loadedChallenges }
}

async function loadBounties() {
  if (!contractConfigured.value) {
    showNotice('Set VITE_CONTRACT_ADDRESS to a deployed ContentBounty v2 contract.', 'error')
    return
  }
  loading.value = true
  try {
    bounties.value = (await readAllBounties()).reverse()
    if (selectedBounty.value) {
      const fresh = bounties.value.find((item) => item.id === selectedBounty.value?.id)
      if (fresh) selectedBounty.value = fresh
    }
  } catch (error: any) {
    showNotice(`Could not load bounties: ${error?.message ?? String(error)}`, 'error')
  } finally {
    loading.value = false
  }
}

async function selectBounty(bounty: Bounty) {
  selectedBounty.value = bounty
  submitForm.value = { evidenceUri: '' }
  challengeTarget.value = null
  await loadSubmissions(bounty.id)
}

async function loadSubmissions(bountyId: number) {
  try {
    submissions.value = await readSubmissionsForBounty(bountyId)
    await loadChallengeDetails(submissions.value)
  } catch (error: any) {
    submissions.value = []
    showNotice(`Could not load submissions: ${error?.message ?? String(error)}`, 'error')
  }
}

async function readSubmissionsForBounty(bountyId: number) {
  const result: Submission[] = []
  for (let offset = 0; ; offset += 50) {
    const page = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_submissions_page',
      args: [bountyId, offset, 50],
    }) as Submission[]
    result.push(...page)
    if (page.length < 50) return result
  }
}

async function openActivity() {
  activeView.value = 'activity'
  if (!walletAddress.value) return
  actionBusy.value = 'activity'
  try {
    const result: Submission[] = []
    for (let offset = 0; ; offset += 50) {
      const page = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: 'get_creator_submissions_page',
        args: [walletAddress.value, offset, 50],
      }) as Submission[]
      result.push(...page)
      if (page.length < 50) break
    }
    activitySubmissions.value = result
    await loadChallengeDetails(result)
  } catch (error: any) {
    showNotice(`Could not load wallet activity: ${error?.message ?? String(error)}`, 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function openBountiesView() {
  activeView.value = 'bounties'
  await refreshSelected()
}

async function openSubmissionBounty(submission: Submission) {
  activeView.value = 'bounties'
  await loadBounties()
  const bounty = bounties.value.find((item) => item.id === submission.bounty_id)
  if (!bounty) {
    showNotice(`Bounty #${submission.bounty_id} is not currently loaded. Refresh the marketplace first.`, 'error')
    return
  }
  await selectBounty(bounty)
}

async function runWrite(
  action: TxEvidence['action'],
  label: string,
  entityId: number | undefined,
  functionName: string,
  args: any[],
  value = 0n,
) {
  if (!walletAddress.value) {
    await connectWallet()
    if (!walletAddress.value) return null
  }
  const signerAddress = walletAddress.value
  await selectWalletChain()
  if (!provider.value) throw new Error('No injected wallet was found. Install a compatible wallet extension.')
  const client = writeClient()
  const hash = await runVerifiedWalletWrite({
    provider: provider.value,
    networkSelector: NETWORK_SELECTOR,
    chain: NETWORK,
    write: () => client.writeContract({
      account: externalAccount(signerAddress),
      address: CONTRACT_ADDRESS,
      functionName,
      args,
      value,
    }) as Promise<string>,
  })

  upsertTransaction({ hash, action, entityId, label, submittedAt: Date.now(), phase: 'SUBMITTED' })
  showNotice(`${label} submitted. Waiting for consensus acceptance.`)

  try {
    const accepted = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      retries: 120,
      interval: 3000,
    })
    const classification = classifyTransaction(accepted)
    applyTransactionClassification(hash, classification)
    if (classification.phase === 'FAILED') {
      throw new Error(classification.failureReason ?? `${label} did not reach a successful consensus result.`)
    }
    if (classification.phase === 'FINALIZED') {
      showNotice(`${label} finalized successfully. Verify any expected balance change independently.`, 'success')
      await refreshSelected()
    } else if (classification.phase === 'ACCEPTED') {
      showNotice(`${label} reached majority agreement with successful execution. Finalization is still pending.`, 'success')
      void waitForFinalization(hash, label)
    } else {
      showNotice(`${label} returned ${classification.statusName || 'an unknown status'} without verified acceptance. Tracking continues.`)
      void waitForFinalization(hash, label)
    }
  } catch (error: any) {
    patchTransaction(hash, { error: error?.message ?? String(error) })
    throw error
  }
  return hash
}

async function waitForFinalization(hash: string, label: string) {
  try {
    const finalized = await readClient.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      retries: 240,
      interval: 5000,
    })
    const classification = classifyTransaction(finalized)
    applyTransactionClassification(hash, classification)
    if (classification.phase === 'FINALIZED') {
      showNotice(`${label} finalized successfully. Refresh chain state and verify any balance transfer independently.`, 'success')
      await refreshSelected()
    } else if (classification.phase === 'FAILED') {
      showNotice(`${label} failed: ${classification.failureReason ?? 'unknown transaction failure'}`, 'error')
    } else {
      showNotice(`${label} returned ${classification.statusName || 'an unknown status'} without verified successful finalization.`)
    }
  } catch (error: any) {
    const message = error?.message ?? String(error)
    if (!/timeout|retries/i.test(message)) patchTransaction(hash, { error: message })
  }
}

async function syncTransaction(entry: TxEvidence) {
  try {
    const transaction = await readClient.getTransaction({ hash: entry.hash })
    applyTransactionClassification(entry.hash, classifyTransaction(transaction))
  } catch (error: any) {
    patchTransaction(entry.hash, { error: error?.message ?? String(error) })
  }
}

async function syncTransactions() {
  actionBusy.value = 'sync'
  await Promise.all(transactions.value.map(syncTransaction))
  actionBusy.value = ''
  await refreshSelected()
}

async function postBounty() {
  actionBusy.value = 'post'
  try {
    const criteria = postForm.value.criteria.map((item) => ({
      id: item.id.trim(),
      requirement: item.requirement.trim(),
    }))
    if (!criteria.length || criteria.some((item) => !item.id || !item.requirement)) {
      throw new Error('Every rubric criterion needs an id and requirement.')
    }
    if (new Set(criteria.map((item) => item.id)).size !== criteria.length) {
      throw new Error('Rubric criterion ids must be unique.')
    }
    const submissionSeconds = Math.round(Number(postForm.value.submissionDays) * 86_400)
    const evaluationSeconds = Math.round(Number(postForm.value.evaluationDays) * 86_400)
    if (!Number.isSafeInteger(submissionSeconds) || !Number.isSafeInteger(evaluationSeconds)) {
      throw new Error('Deadline values are invalid.')
    }
    const hash = await runWrite(
      'POST',
      `Post bounty “${postForm.value.title.trim()}”`,
      undefined,
      'post_bounty',
      [
        postForm.value.title.trim(),
        postForm.value.description.trim(),
        JSON.stringify(criteria),
        submissionSeconds,
        evaluationSeconds,
      ],
      parseGenAmount(postForm.value.reward),
    )
    if (hash) {
      postForm.value = {
        title: '', description: '', reward: '', submissionDays: '7', evaluationDays: '3',
        criteria: [{ id: 'c1', requirement: '' }, { id: 'c2', requirement: '' }],
      }
      activeView.value = 'transactions'
      await loadBounties()
    }
  } catch (error: any) {
    showNotice(error?.message ?? String(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function submitEvidence() {
  if (!selectedBounty.value) return
  actionBusy.value = 'submit'
  try {
    const uri = submitForm.value.evidenceUri
    if (!claimTag.value) throw new Error('Connect the submitting wallet and load its claim tag before publishing or submitting.')
    const uriError = validateSourceUri(uri, allowedSources.value)
    if (uriError) throw new Error(uriError)
    const hash = await runWrite(
      'SUBMIT',
      `Submit evidence to bounty #${selectedBounty.value.id}`,
      selectedBounty.value.id,
      'submit_content',
      [selectedBounty.value.id, uri],
    )
    if (hash) {
      submitForm.value = { evidenceUri: '' }
      await refreshSelected()
    }
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function evaluateSubmission(submission: Submission) {
  actionBusy.value = `evaluate-${submission.id}`
  try {
    await runWrite(
      'EVALUATE',
      `Evaluate submission #${submission.id}`,
      submission.id,
      'evaluate_submission',
      [submission.id],
    )
    await refreshSelected()
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function openChallengeModal(submission: Submission) {
  if (!walletAddress.value) {
    await connectWallet()
    if (!walletAddress.value) return
  }
  if (isCreator(submission)) {
    showNotice('The submission creator cannot challenge their own submission.', 'error')
    return
  }
  actionBusy.value = `challenge-prepare-${submission.id}`
  try {
    const rawBond = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_challenge_bond',
      args: [submission.id],
    }) as number | string | bigint
    challengeBond.value = BigInt(rawBond)
    challengeTarget.value = submission
    challengeForm.value = {
      reasonCode: 'RIGHTS_OR_PLAGIARISM',
      evidenceUri: '',
      confirmed: false,
    }
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

function closeChallengeModal() {
  challengeTarget.value = null
  challengeBond.value = 0n
  challengeForm.value.confirmed = false
}

async function submitChallenge() {
  const submission = challengeTarget.value
  if (!submission) return
  actionBusy.value = `challenge-${submission.id}`
  try {
    if (!challengeForm.value.confirmed) throw new Error('Confirm the challenge bond routing before continuing.')
    const uri = challengeForm.value.evidenceUri
    const uriError = validateSourceUri(uri, allowedSources.value)
    if (uriError) throw new Error(uriError)
    await runWrite(
      'CHALLENGE',
      `Challenge submission #${submission.id}`,
      submission.id,
      'challenge_submission',
      [submission.id, challengeForm.value.reasonCode, uri],
      challengeBond.value,
    )
    closeChallengeModal()
    await refreshSelected()
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function reviewChallenge(challenge: Challenge) {
  actionBusy.value = `review-challenge-${challenge.id}`
  try {
    const hash = await runWrite(
      'REVIEW_CHALLENGE',
      `Review challenge #${challenge.id}`,
      challenge.id,
      'review_challenge',
      [challenge.id],
    )
    if (!hash) return
    await refreshSelected()
    const updated = challenges.value[challenge.id]
    if (updated?.proposed_outcome === 'INCONCLUSIVE') {
      showNotice(
        `Challenge review was inconclusive (attempt ${updated.attempt_count} of 3). Retry while eligible, or use timeout when its attempt or deadline condition is met.`,
        'info',
      )
    }
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function finalizeChallenge(challenge: Challenge) {
  actionBusy.value = `finalize-challenge-${challenge.id}`
  try {
    await runWrite(
      'FINALIZE_CHALLENGE',
      `Finalize challenge #${challenge.id}`,
      challenge.id,
      'finalize_challenge',
      [challenge.id],
    )
    await refreshSelected()
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function timeoutChallenge(challenge: Challenge) {
  actionBusy.value = `timeout-challenge-${challenge.id}`
  try {
    await runWrite(
      'TIMEOUT_CHALLENGE',
      `Time out challenge #${challenge.id}`,
      challenge.id,
      'timeout_challenge',
      [challenge.id],
    )
    await refreshSelected()
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function claimReward(submission: Submission) {
  actionBusy.value = `claim-${submission.id}`
  try {
    await runWrite(
      'CLAIM',
      `Claim reward for submission #${submission.id}`,
      submission.id,
      'claim_reward',
      [submission.id],
    )
    await refreshSelected()
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function cancelBounty(bounty: Bounty) {
  actionBusy.value = 'cancel'
  try {
    await runWrite('CANCEL', `Cancel bounty #${bounty.id}`, bounty.id, 'cancel_bounty', [bounty.id])
    await refreshSelected()
  } catch (error: any) {
    showNotice(error?.message ?? String(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function expireBounty(bounty: Bounty) {
  actionBusy.value = 'expire'
  try {
    await runWrite('EXPIRE', `Expire bounty #${bounty.id}`, bounty.id, 'expire_bounty', [bounty.id])
    await refreshSelected()
  } catch (error: any) {
    showNotice(error?.message ?? String(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function refreshSelected() {
  await loadBounties()
  if (selectedBounty.value) await loadSubmissions(selectedBounty.value.id)
}

function addCriterion() {
  if (postForm.value.criteria.length >= 8) return
  postForm.value.criteria.push({ id: `c${postForm.value.criteria.length + 1}`, requirement: '' })
}

function removeCriterion(index: number) {
  if (postForm.value.criteria.length <= 1) return
  postForm.value.criteria.splice(index, 1)
}

function isPoster(bounty: Bounty) {
  return Boolean(walletAddress.value) && bounty.poster.toLowerCase() === walletAddress.value.toLowerCase()
}

function canExpire(bounty: Bounty) {
  return ['OPEN', 'LOCKED'].includes(bounty.status)
    && nowSeconds.value > bounty.evaluation_deadline
    && !bounty.has_provisional_winner
}

function onAccountsChanged(accounts: string[]) {
  walletAddress.value = (accounts?.[0] ?? '') as Address | ''
  if (activeView.value === 'activity' && walletAddress.value) void openActivity()
}

function onChainChanged() {
  showNotice('Wallet network changed. Reconnect to transact on the configured GenLayer network.')
}

onMounted(async () => {
  provider.value?.on?.('accountsChanged', onAccountsChanged)
  provider.value?.on?.('chainChanged', onChainChanged)
  await restoreWallet()
  await loadAllowedSources()
  await loadBounties()
  clockHandle = window.setInterval(() => {
    nowSeconds.value = Math.floor(Date.now() / 1000)
  }, 1000)
  for (const entry of transactions.value.filter((item) => !['FINALIZED', 'FAILED'].includes(item.phase))) {
    void syncTransaction(entry)
  }
})

watch([walletAddress, () => selectedBounty.value?.id], () => {
  void loadClaimTag()
})

onUnmounted(() => {
  claimTagRequestId += 1
  if (clockHandle !== undefined) window.clearInterval(clockHandle)
  provider.value?.removeListener?.('accountsChanged', onAccountsChanged)
  provider.value?.removeListener?.('chainChanged', onChainChanged)
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" @click="openBountiesView">
        <span class="brand-mark">CB</span>
        <span><strong>ContentBounty</strong><small>verifiable creative work</small></span>
      </button>
      <nav>
        <button :class="{ active: activeView === 'bounties' }" @click="openBountiesView">Bounties</button>
        <button :class="{ active: activeView === 'post' }" @click="activeView = 'post'">Post</button>
        <button :class="{ active: activeView === 'activity' }" @click="openActivity">My activity</button>
        <button :class="{ active: activeView === 'transactions' }" @click="activeView = 'transactions'">Transactions</button>
      </nav>
      <div class="wallet-area">
        <span class="network-dot"></span><span class="network-name">{{ NETWORK_LABEL }}</span>
        <button v-if="!connected" class="button primary compact" @click="connectWallet">Connect wallet</button>
        <button v-else class="wallet-button" @click="disconnectWallet" :title="walletAddress">
          {{ shortAddress(walletAddress) }} <span>disconnect</span>
        </button>
      </div>
    </header>

    <div v-if="notice" :class="['notice', `notice-${notice.type}`]">
      <span>{{ notice.message }}</span><button @click="notice = null">×</button>
    </div>

    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">ContentBounty v2 · consensus adjudication</p>
          <h1>Escrow for work that can prove itself.</h1>
          <p class="hero-copy">Creators commit immutable evidence. Independent GenLayer validators test every ordered criterion, while deterministic contract code controls the verdict and full reward.</p>
        </div>
        <div class="hero-proof">
          <span>Equivalence rule</span>
          <strong>digest + decision + bits + bucket + reason</strong>
          <small>Feedback wording never controls settlement.</small>
        </div>
      </section>

      <section class="metrics">
        <div><strong>{{ bounties.length }}</strong><span>known bounties</span></div>
        <div><strong>{{ openBounties }}</strong><span>accepting or evaluating</span></div>
        <div><strong>{{ formatWei(lockedValue) }} GEN</strong><span>contract escrow in active bounties</span></div>
        <div><strong>{{ verifiedFinalizedTransactions }}</strong><span>verified successful finalizations</span></div>
      </section>

      <section v-if="activeView === 'bounties'" class="workspace">
        <div class="section-heading">
          <div><p class="eyebrow">Marketplace</p><h2>Browse bounties</h2></div>
          <button class="button secondary" :disabled="loading" @click="refreshSelected">{{ loading ? 'Loading…' : 'Refresh' }}</button>
        </div>

        <div v-if="!contractConfigured" class="empty-card">
          <h3>Contract address required</h3>
          <p>Set <code>VITE_CONTRACT_ADDRESS</code> to the deployed v2 address. The historical v0.2 deployment is explicitly blocked as incompatible.</p>
        </div>
        <div v-else-if="!loading && !bounties.length" class="empty-card"><h3>No bounties yet</h3><p>Post the first bounded rubric and escrow.</p></div>
        <div v-else class="bounty-layout">
          <div class="bounty-list">
            <button v-for="bounty in bounties" :key="bounty.id" :class="['bounty-card', { selected: selectedBounty?.id === bounty.id }]" @click="selectBounty(bounty)">
              <div class="card-line"><span class="mono">#{{ bounty.id }}</span><span :class="statusClass(bounty.status)">{{ bounty.status }}</span></div>
              <h3>{{ bounty.title }}</h3>
              <p>{{ bounty.description || 'No description supplied.' }}</p>
              <div class="card-line"><strong>{{ formatWei(bounty.reward) }} GEN</strong><span>{{ bounty.submission_count }} submission{{ bounty.submission_count === 1 ? '' : 's' }}</span></div>
            </button>
          </div>

          <article v-if="selectedBounty" class="detail-panel">
            <div class="detail-head">
              <div><p class="eyebrow">Bounty #{{ selectedBounty.id }}</p><h2>{{ selectedBounty.title }}</h2></div>
              <span :class="statusClass(selectedBounty.status)">{{ selectedBounty.status }}</span>
            </div>
            <p class="description">{{ selectedBounty.description || 'No description supplied.' }}</p>
            <dl class="facts">
              <div><dt>Reward</dt><dd>{{ formatWei(selectedBounty.reward) }} GEN</dd></div>
              <div><dt>Poster</dt><dd><a :href="`${EXPLORER_URL}/address/${selectedBounty.poster}`" target="_blank" rel="noreferrer">{{ shortAddress(selectedBounty.poster) }}</a></dd></div>
              <div><dt>Submit by</dt><dd>{{ formatDate(selectedBounty.submission_deadline) }}</dd></div>
              <div><dt>Evaluate by</dt><dd>{{ formatDate(selectedBounty.evaluation_deadline) }}</dd></div>
            </dl>

            <div class="rubric">
              <p class="label">Ordered rubric · {{ selectedBounty.rubric_version }}</p>
              <ol><li v-for="criterion in rubricFor(selectedBounty)" :key="criterion.id"><strong>{{ criterion.id }}</strong><span>{{ criterion.requirement }}</span></li></ol>
            </div>

            <div class="detail-actions">
              <button v-if="isPoster(selectedBounty) && selectedBounty.status === 'OPEN' && selectedBounty.submission_count === 0" class="button danger" :disabled="Boolean(actionBusy)" @click="cancelBounty(selectedBounty)">Cancel and request refund</button>
              <button v-if="canExpire(selectedBounty)" class="button secondary" :disabled="Boolean(actionBusy)" @click="expireBounty(selectedBounty)">Expire permissionlessly</button>
            </div>

            <form v-if="['OPEN', 'LOCKED'].includes(selectedBounty.status) && nowSeconds <= selectedBounty.submission_deadline" class="evidence-form" @submit.prevent="submitEvidence">
              <div><p class="label">Publish with your wallet claim tag</p><p class="hint">This tag is specific to the selected bounty, connected wallet, chain, and contract version. Put the exact token in the public source before submitting its URL.</p></div>
              <div v-if="!connected" class="claim-tag-callout"><strong>Connect the wallet that will submit.</strong><span>The contract derives a different tag for every creator address.</span><button type="button" class="button secondary" @click="connectWallet">Connect wallet</button></div>
              <div v-else class="claim-tag-callout">
                <span class="label">Required token</span>
                <div class="claim-tag-row"><code>{{ claimTagLoading ? 'Loading…' : claimTag || 'Unavailable' }}</code><button type="button" class="button secondary compact" :disabled="!claimTag" @click="copyClaimTag">Copy</button></div>
                <strong>Publish first, submit second.</strong>
                <span>On immutable or non-editable platforms, an omitted tag cannot be repaired in this version. Do not publish until this token is included; there is no post-publication or same-submission repair path.</span>
              </div>
              <div><p class="label">Supported publishing surfaces</p><p class="source-list">{{ supportedSourceLabels.join(' · ') || 'Loading contract allowlist…' }}</p><p class="hint">The allowlist constrains renderable sources; it is not proof of authorship or legal ownership.</p></div>
              <label>Source HTTPS URI<input v-model="submitForm.evidenceUri" type="url" maxlength="512" required placeholder="https://github.com/…" /></label>
              <p v-if="submitUriError" class="field-error">{{ submitUriError }}</p>
              <button class="button primary" :disabled="Boolean(actionBusy) || !claimTag || Boolean(submitUriError)">{{ actionBusy === 'submit' ? 'Rendering and submitting…' : 'Submit source for consensus render' }}</button>
            </form>

            <div class="submissions">
              <div class="section-heading compact-heading"><div><p class="label">Submissions</p><p class="hint">Evaluation is permissionless. Inconclusive attempts can retry up to three times.</p></div><button class="text-button" @click="loadSubmissions(selectedBounty.id)">Refresh</button></div>
              <div v-if="!submissions.length" class="empty-inline">No submissions.</div>
              <article v-for="submission in submissions" :key="submission.id" class="submission-card">
                <div class="submission-head"><div><span class="mono">Submission #{{ submission.id }}</span><a :href="submission.evidence_uri" target="_blank" rel="noreferrer">Open evidence ↗</a></div><span :class="statusClass(submission.status)">{{ submission.status }}</span></div>
                <p class="digest mono">sha256:{{ submission.evidence_sha256 }}</p>
                <p v-if="submission.claim_tag" class="digest mono">claim:{{ submission.claim_tag }} · {{ submission.claim_tag_version }}</p>
                <dl class="result-grid">
                  <div><dt>Creator</dt><dd>{{ shortAddress(submission.creator) }}</dd></div>
                  <div><dt>Attempts</dt><dd>{{ submission.attempt_count }} / 3</dd></div>
                  <div><dt>Decision</dt><dd>{{ submission.decision || 'NOT EVALUATED' }}</dd></div>
                  <div><dt>Score bucket</dt><dd>{{ submission.decision ? `${submission.score_bucket} / 4` : '—' }}</dd></div>
                  <div><dt>Criteria bits</dt><dd class="mono">{{ submission.criteria_bits || '—' }}</dd></div>
                  <div><dt>Reason</dt><dd>{{ submission.reason_code || '—' }}</dd></div>
                </dl>
                <p v-if="submission.feedback" class="feedback">{{ submission.feedback }}</p>
                <p v-if="sourceStateLabel(submission)" class="field-error">{{ sourceStateLabel(submission) }}</p>
                <p v-if="settlementLabel(submission)" class="settlement-note">{{ settlementLabel(submission) }}</p>
                <div v-if="submission.status === 'APPROVED_PENDING'" class="pending-panel">
                  <dl class="result-grid compact-grid">
                    <div><dt>Approved at</dt><dd>{{ formatDate(submission.approved_at) }}</dd></div>
                    <div><dt>Challenge deadline</dt><dd>{{ formatDate(submission.challenge_deadline) }}</dd></div>
                    <div><dt>Local countdown</dt><dd>{{ formatCountdown(submission.challenge_deadline, nowSeconds) }}</dd></div>
                  </dl>
                  <p class="hint">Countdown is informational. The GenVM transaction timestamp is authoritative.</p>
                </div>
                <div v-if="challengeFor(submission)" class="challenge-panel">
                  <div class="submission-head"><div><p class="label">Challenge #{{ challengeFor(submission)?.id }}</p><span :class="statusClass(challengeFor(submission)?.status || 'OPEN')">{{ challengeFor(submission)?.status }}</span></div><a :href="challengeFor(submission)?.evidence_uri" target="_blank" rel="noreferrer">Open evidence ↗</a></div>
                  <dl class="result-grid">
                    <div><dt>Challenger</dt><dd>{{ shortAddress(challengeFor(submission)?.challenger || '') }}</dd></div>
                    <div><dt>Reason</dt><dd>{{ challengeFor(submission)?.reason_code }}</dd></div>
                    <div><dt>Bond</dt><dd>{{ formatWei(challengeFor(submission)?.bond || 0, 18) }} GEN</dd></div>
                    <div><dt>Evidence digest</dt><dd class="mono">{{ challengeFor(submission)?.evidence_sha256 }}</dd></div>
                    <div><dt>Attempts</dt><dd>{{ challengeFor(submission)?.attempt_count }} / 3</dd></div>
                    <div><dt>Review deadline</dt><dd>{{ formatDate(challengeFor(submission)?.review_deadline || 0) }}</dd></div>
                    <div><dt>Proposed outcome</dt><dd>{{ challengeFor(submission)?.proposed_outcome || 'NONE' }}</dd></div>
                    <div><dt>Final outcome</dt><dd>{{ challengeFor(submission)?.status === 'OPEN' ? 'PENDING' : challengeFor(submission)?.status }}</dd></div>
                    <div><dt>Bond disposition</dt><dd>{{ challengeFor(submission)?.bond_disposition || 'ESCROWED' }}</dd></div>
                  </dl>
                  <p class="digest mono">evidence: <a :href="challengeFor(submission)?.evidence_uri" target="_blank" rel="noreferrer">{{ challengeFor(submission)?.evidence_uri }}</a></p>
                  <p v-if="challengeFor(submission)?.proposed_feedback" class="feedback">{{ challengeFor(submission)?.proposed_error_class }} {{ challengeFor(submission)?.proposed_feedback }}</p>
                </div>
                <div class="submission-actions">
                  <button v-if="canEvaluate(submission)" class="button secondary" :disabled="Boolean(actionBusy)" @click="evaluateSubmission(submission)">{{ actionBusy === `evaluate-${submission.id}` ? 'Evaluating…' : submission.status === 'INCONCLUSIVE' ? 'Retry evaluation' : 'Evaluate submission' }}</button>
                  <button v-if="canChallenge(submission)" class="button danger" :disabled="Boolean(actionBusy)" @click="openChallengeModal(submission)">Challenge</button>
                  <button v-if="canReviewSubmissionChallenge(submission)" class="button secondary" :disabled="Boolean(actionBusy)" @click="reviewSubmissionChallenge(submission)">Review challenge</button>
                  <button v-if="canFinalizeSubmissionChallenge(submission)" class="button primary" :disabled="Boolean(actionBusy)" @click="finalizeSubmissionChallenge(submission)">Finalize challenge</button>
                  <button v-if="canTimeoutSubmissionChallenge(submission)" class="button secondary" :disabled="Boolean(actionBusy)" @click="timeoutSubmissionChallenge(submission)">Timeout challenge</button>
                  <button v-if="canClaimReward(submission)" class="button primary" :disabled="Boolean(actionBusy)" @click="claimReward(submission)">{{ actionBusy === `claim-${submission.id}` ? 'Claiming…' : 'Claim reward' }}</button>
                </div>
              </article>
            </div>
          </article>
          <div v-else class="detail-placeholder"><span>←</span><p>Select a bounty to inspect its rubric, deadlines, submissions, and settlement evidence.</p></div>
        </div>
      </section>

      <section v-else-if="activeView === 'post'" class="workspace narrow">
        <div class="section-heading"><div><p class="eyebrow">Fund a result</p><h2>Post a bounded bounty</h2></div></div>
        <form class="post-form" @submit.prevent="postBounty">
          <div class="form-grid">
            <label>Title<input v-model="postForm.title" required maxlength="120" placeholder="A precise, outcome-focused title" /></label>
            <label>Reward in GEN<input v-model="postForm.reward" required inputmode="decimal" placeholder="10.0" /></label>
          </div>
          <label>Description<textarea v-model="postForm.description" maxlength="1500" rows="4" placeholder="Context, audience, and delivery expectations"></textarea></label>
          <div class="form-grid">
            <label>Submission window (days)<input v-model="postForm.submissionDays" required type="number" min="0.0034722222" max="90" step="0.01" /></label>
            <label>Evaluation grace (days)<input v-model="postForm.evaluationDays" required type="number" min="0.0034722222" max="30" step="0.01" /></label>
          </div>
          <div class="rubric-builder">
            <div class="section-heading compact-heading"><div><p class="label">Ordered rubric</p><p class="hint">Every criterion is required for approval. IDs must remain unique and stable.</p></div><button type="button" class="text-button" :disabled="postForm.criteria.length >= 8" @click="addCriterion">+ Add criterion</button></div>
            <div v-for="(criterion, index) in postForm.criteria" :key="index" class="criterion-row">
              <input v-model="criterion.id" required maxlength="32" pattern="[A-Za-z0-9_-]+" aria-label="Criterion id" />
              <textarea v-model="criterion.requirement" required maxlength="400" rows="2" :aria-label="`Criterion ${index + 1} requirement`"></textarea>
              <button type="button" class="remove-button" :disabled="postForm.criteria.length === 1" @click="removeCriterion(index)">×</button>
            </div>
          </div>
          <div class="security-callout"><strong>Your wallet signs; this app never asks for or stores a private key.</strong><span>The escrow amount is parsed as an exact 18-decimal integer. Contract validation remains authoritative.</span></div>
          <button class="button primary large" :disabled="Boolean(actionBusy)">{{ actionBusy === 'post' ? 'Posting…' : 'Post bounty and escrow reward' }}</button>
          <p v-if="walletError" class="field-error">{{ walletError }}</p>
        </form>
      </section>

      <section v-else-if="activeView === 'activity'" class="workspace">
        <div class="section-heading"><div><p class="eyebrow">Wallet-scoped view</p><h2>My activity</h2></div><button v-if="!connected" class="button primary" @click="connectWallet">Connect wallet</button></div>
        <div v-if="!connected" class="empty-card"><h3>No account connected</h3><p>Connect an injected wallet to filter public submissions by creator. No secret keys enter this application.</p></div>
        <div v-else-if="actionBusy === 'activity'" class="empty-card"><h3>Loading paginated activity…</h3><p>Reading the bounded creator index without scanning the marketplace.</p></div>
        <div v-else-if="!mySubmissions.length" class="empty-card"><h3>No submissions for {{ shortAddress(walletAddress) }}</h3><p>This address has no submissions in the currently loaded v2 bounties.</p></div>
        <div v-else class="activity-grid">
          <article v-for="submission in mySubmissions" :key="submission.id" class="submission-card">
            <div class="submission-head"><button class="text-button" type="button" @click="openSubmissionBounty(submission)">Bounty #{{ submission.bounty_id }} · Submission #{{ submission.id }}</button><span :class="statusClass(submission.status)">{{ submission.status }}</span></div>
            <a :href="submission.evidence_uri" target="_blank" rel="noreferrer">{{ submission.evidence_uri }}</a>
            <p class="feedback">{{ submission.feedback || 'Not evaluated yet.' }}</p>
            <div v-if="submission.status === 'APPROVED_PENDING'" class="pending-panel">
              <dl class="result-grid compact-grid">
                <div><dt>Challenge deadline</dt><dd>{{ formatDate(submission.challenge_deadline) }}</dd></div>
                <div><dt>Local countdown</dt><dd>{{ formatCountdown(submission.challenge_deadline, nowSeconds) }}</dd></div>
                <div><dt>Challenge</dt><dd>{{ challengeFor(submission) ? `#${challengeFor(submission)?.id} ${challengeFor(submission)?.status}` : 'None recorded' }}</dd></div>
              </dl>
              <p class="hint">Countdown is informational. Open the bounty for challenge, review, timeout, and claim actions.</p>
            </div>
            <button class="button secondary compact" type="button" @click="openSubmissionBounty(submission)">Open bounty actions</button>
          </article>
        </div>
      </section>

      <section v-else class="workspace">
        <div class="section-heading"><div><p class="eyebrow">Local transaction evidence</p><h2>Acceptance is not finality</h2><p class="section-copy">Only transaction identifiers and observed lifecycle states are persisted here. This list contains no wallet secrets and does not prove a recipient balance delta.</p></div><button class="button secondary" :disabled="actionBusy === 'sync'" @click="syncTransactions">{{ actionBusy === 'sync' ? 'Syncing…' : 'Sync statuses' }}</button></div>
        <div v-if="!transactions.length" class="empty-card"><h3>No transaction evidence yet</h3><p>Transactions submitted through this browser will survive reload and progress from submitted to accepted to finalized.</p></div>
        <div v-else class="transaction-list">
          <article v-for="entry in transactions" :key="entry.hash" class="transaction-card">
            <div><span :class="statusClass(entry.phase)">{{ entry.phase }}</span><strong>{{ entry.label }}</strong><small>{{ new Date(entry.submittedAt).toLocaleString() }}</small></div>
            <div><a :href="`${EXPLORER_URL}/tx/${entry.hash}`" target="_blank" rel="noreferrer" class="mono">{{ shortAddress(entry.hash) }} ↗</a><span v-if="entry.statusName">status: {{ entry.statusName }}</span><span v-if="entry.resultName">consensus: {{ entry.resultName }}</span><span v-if="entry.executionResultName">execution: {{ entry.executionResultName }}</span><small v-if="entry.failureReason">{{ entry.failureReason }}</small><small v-if="entry.error">Observation error: {{ entry.error }}</small></div>
          </article>
        </div>
        <div class="finality-guide">
          <div><span class="phase-dot submitted"></span><strong>Submitted</strong><p>The consensus transaction id exists. No verdict is claimed.</p></div>
          <div><span class="phase-dot accepted"></span><strong>Accepted</strong><p>A majority agreed and execution returned successfully, but an appeal/finalization window may remain.</p></div>
          <div><span class="phase-dot finalized"></span><strong>Finalized successfully</strong><p>Final status, majority agreement, and successful execution are all present. Verify recipient balance separately before claiming payment confirmation.</p></div>
        </div>
      </section>
    </main>

    <div v-if="challengeTarget" class="modal-backdrop" @click.self="closeChallengeModal">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="challenge-title">
        <div class="section-heading compact-heading">
          <div><p class="eyebrow">Pre-payout challenge</p><h2 id="challenge-title">Challenge submission #{{ challengeTarget.id }}</h2></div>
          <button class="text-button" type="button" @click="closeChallengeModal">Close</button>
        </div>
        <p class="section-copy">The evidence is reviewed by a second consensus round. Review proposes an outcome; deterministic finalization handles the bond and submission state.</p>
        <label>Reason
          <select v-model="challengeForm.reasonCode">
            <option v-for="reason in CHALLENGE_REASONS" :key="reason.value" :value="reason.value">{{ reason.label }}</option>
          </select>
        </label>
        <label>HTTPS evidence URI<input v-model="challengeForm.evidenceUri" type="url" maxlength="512" placeholder="https://gist.github.com/…" /></label>
        <p v-if="challengeForm.evidenceUri && validateSourceUri(challengeForm.evidenceUri, allowedSources)" class="field-error">{{ validateSourceUri(challengeForm.evidenceUri, allowedSources) }}</p>
        <div class="bond-callout"><strong>Exact bond: {{ formatWei(challengeBond, 18) }} GEN</strong><span>Dismissed challenges route the bond to the submission creator. Upheld and timed-out challenges return it to the challenger. The contract requires exact payment.</span></div>
        <label class="checkbox-label"><input v-model="challengeForm.confirmed" type="checkbox" /> I understand the bond routing and confirm this evidence is submitted in good faith.</label>
        <div class="modal-actions"><button class="button secondary" type="button" @click="closeChallengeModal">Cancel</button><button class="button primary" type="button" :disabled="Boolean(actionBusy) || !challengeForm.confirmed || !challengeForm.evidenceUri || Boolean(validateSourceUri(challengeForm.evidenceUri, allowedSources))" @click="submitChallenge">Submit challenge</button></div>
      </section>
    </div>

    <footer>
      <div><strong>ContentBounty v2</strong><span>{{ NETWORK_LABEL }} ({{ NETWORK_SELECTOR }}) · {{ RPC_URL }}</span></div>
      <div><a v-if="contractConfigured" :href="`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`" target="_blank" rel="noreferrer">Contract {{ shortAddress(CONTRACT_ADDRESS) }} ↗</a><span v-else>v2 contract not configured</span><span>External signer only</span></div>
    </footer>
  </div>
</template>
