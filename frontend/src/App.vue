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
import {
  availableActions,
  sameAddress,
  type BountyState,
  type ChallengeState,
  type SubmissionState,
} from './lib/statusActions'
import { describeVerdict, type VerdictRecord } from './lib/verdict'

type Address = `0x${string}`

interface Bounty extends BountyState {
  title: string
  description: string
  rubric_json: string
  rubric_sha256: string
  rubric_version: string
  reward: number | string | bigint
  created_at: number
  status: 'OPEN' | 'LOCKED' | 'FILLED' | 'CANCELLED' | 'EXPIRED'
  has_winner: boolean
  winner_submission_id: number
}

interface Submission extends SubmissionState {
  evidence_uri: string
  evidence_sha256: string
  status: 'PENDING' | 'APPROVED_PENDING' | 'APPROVED' | 'REJECTED' | 'INCONCLUSIVE' | 'SUPERSEDED'
  submitted_at: number
  evaluated_at: number
  decision: '' | 'APPROVE' | 'REJECT' | 'INCONCLUSIVE'
  criteria_bits: string
  score_bucket: number
  reason_code: string
  verdict_code: string
  rubric_version: string
  evaluator_version: string
  claim_tag: string
  claim_tag_version: string
  approved_at: number
  latest_challenge_id: number
}

interface Challenge extends ChallengeState {
  submission_id: number
  bounty_id: number
  challenger: string
  reason_code: ChallengeReason
  evidence_uri: string
  evidence_sha256: string
  status: 'OPEN' | 'UPHELD' | 'DISMISSED' | 'TIMED_OUT'
  created_at: number
  proposed_outcome: '' | 'UPHOLD' | 'DISMISS' | 'INCONCLUSIVE'
  proposed_reason_code: string
  proposed_error_class: string
  reviewed_at: number
  finalized_at: number
  bond_released: boolean
  bond_recipient: string
  bond_disposition: string
}

interface EscrowAccounting {
  bounty_escrow_total: number
  refund_pending_total: number
  reward_pending_total: number
  bond_escrowed_total: number
  bond_pending_total: number
  expected_native_balance: number
  bounty_count: number
  submission_count: number
  challenge_count: number
}

interface CriterionDraft {
  id: string
  requirement: string
}

interface TxEvidence {
  hash: string
  action: 'POST' | 'SUBMIT' | 'EVALUATE' | 'CANCEL' | 'EXPIRE' | 'CHALLENGE' | 'REVIEW_CHALLENGE' | 'FINALIZE_CHALLENGE' | 'TIMEOUT_CHALLENGE' | 'CLAIM' | 'WITHDRAW_REWARD' | 'WITHDRAW_REFUND' | 'WITHDRAW_BOND'
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
const bountiesError = ref('')
const selectedBounty = ref<Bounty | null>(null)
const submissions = ref<Submission[]>([])
const submissionsLoading = ref(false)
const submissionsError = ref('')
const activitySubmissions = ref<Submission[]>([])
const transactions = ref<TxEvidence[]>(loadTransactions())
const allowedSources = ref<string[]>([])
const claimTag = ref('')
const claimTagLoading = ref(false)
const challenges = ref<Record<number, Challenge>>({})
const verdicts = ref<Record<number, VerdictRecord>>({})
const escrow = ref<EscrowAccounting | null>(null)
const escrowError = ref('')
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
  challengeWindowHours: '48',
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
const escrowTotal = computed(() => {
  if (!escrow.value) return 0n
  return BigInt(escrow.value.expected_native_balance ?? 0)
})
const submitUriError = computed(() => {
  const uri = submitForm.value.evidenceUri
  return uri ? validateSourceUri(uri, allowedSources.value) : null
})
const supportedSourceLabels = computed(() => allowedSources.value.map((host) => (
  host === 'substack.com' ? 'substack.com + subdomains' : host
)))

const actionSet = computed(() => availableActions({
  now: nowSeconds.value,
  wallet: walletAddress.value || null,
  bounty: selectedBounty.value,
  submissions: submissions.value,
  challenges: Object.values(challenges.value),
}))

const bountyActions = computed(() => actionSet.value.bounty)
const submissionActions = computed(() => actionSet.value.submission)
const challengeActions = computed(() => actionSet.value.challenge)

function hasBountyAction(action: string) {
  return bountyActions.value.includes(action as never)
}

function hasSubmissionAction(submissionId: number, action: string) {
  return (submissionActions.value[submissionId] ?? []).includes(action as never)
}

function hasChallengeAction(challengeId: number, action: string) {
  return (challengeActions.value[challengeId] ?? []).includes(action as never)
}

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

function disputeWindowLabel(bounty: Bounty): string {
  const hours = (bounty.challenge_window_seconds ?? 0) / 3_600
  if (hours >= 1) return `${hours} h`
  return `${Math.round((bounty.challenge_window_seconds ?? 0) / 60)} min`
}

function refundLabel(bounty: Bounty): string {
  if (bounty.refund_status === 'PENDING') return `${formatWei(bounty.refund_amount)} GEN pending withdrawal`
  if (bounty.refund_status === 'WITHDRAWN') return `${formatWei(bounty.refund_amount)} GEN withdrawn`
  return 'None recorded'
}

function rewardLabel(submission: Submission): string {
  if (submission.reward_status === 'PENDING') return `${formatWei(submission.reward_amount)} GEN pending withdrawal`
  if (submission.reward_status === 'WITHDRAWN') return `${formatWei(submission.reward_amount)} GEN withdrawn`
  return 'Not claimable yet'
}

function bondDispositionLabel(challenge: Challenge | undefined): string {
  if (!challenge) return 'ESCROWED'
  if (challenge.bond_status === 'WITHDRAWN') return 'WITHDRAWN'
  if (challenge.bond_status === 'PENDING') return `${challenge.bond_disposition || 'RECIPIENT'} — pending withdrawal`
  return 'ESCROWED'
}

function statusClass(status: string) {
  return `status status-${status.toLowerCase()}`
}

function challengeFor(submission: Submission) {
  return submission.latest_challenge_id ? challenges.value[submission.latest_challenge_id] : undefined
}

function isCreator(submission: Submission) {
  return sameAddress(submission.creator, walletAddress.value)
}

function bountyForSubmission(submission: Submission) {
  return bounties.value.find((bounty) => bounty.id === submission.bounty_id)
}

function evaluationEvidence(submissionId: number) {
  return transactions.value.find((entry) => entry.action === 'EVALUATE' && entry.entityId === submissionId)
}

function claimEvidence(submissionId: number) {
  return transactions.value.find((entry) => entry.action === 'CLAIM' && entry.entityId === submissionId)
}

function verdictFor(submissionId: number) {
  return verdicts.value[submissionId]
}function verdictView(submissionId: number) {
  const record = verdictFor(submissionId)
  if (!record) return null
  return describeVerdict(record)
}

function settlementLabel(submission: Submission) {
  if (submission.status === 'APPROVED_PENDING') {
    return `Consensus approved this submission, but no creator reward has moved. Dispute window: ${formatCountdown(submission.challenge_deadline, nowSeconds.value)}.`
  }
  if (submission.reward_status === 'PENDING') {
    return 'The reward is recorded as withdrawable. Nothing has moved until the creator withdraws it.'
  }
  if (submission.reward_status === 'WITHDRAWN') {
    const evidence = claimEvidence(submission.id)
    if (!evidence) {
      return 'The reward was withdrawn by the creator. This browser has no local record of the withdrawal transaction; verify finalization and the recipient balance independently.'
    }
    const classification = classifyTransaction({
      statusName: evidence.statusName,
      resultName: evidence.resultName,
      txExecutionResultName: evidence.executionResultName,
    })
    if (classification.phase === 'FINALIZED') {
      return 'The withdrawal finalized successfully. Confirm the creator balance delta before describing the reward as paid.'
    }
    if (classification.phase === 'ACCEPTED') {
      return 'The withdrawal reached consensus but is not finalized yet.'
    }
    if (classification.phase === 'FAILED') {
      return `The recorded withdrawal transaction failed: ${classification.failureReason ?? 'unknown failure'}.`
    }
    return 'The withdrawal was submitted and remains unconfirmed.'
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
  if (submission.verdict_code === 'CLAIM_TAG_MISSING') return 'The required wallet claim tag is absent from the current rendered source.'
  if (submission.reason_code === 'DIGEST_MISMATCH') return 'The current rendered source no longer matches the submitted digest.'
  return ''
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

function withdrawSubmissionChallenge(submission: Submission) {
  const challenge = challengeFor(submission)
  if (challenge) void withdrawBond(challenge)
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
  bountiesError.value = ''
  try {
    bounties.value = (await readAllBounties()).reverse()
    if (selectedBounty.value) {
      const fresh = bounties.value.find((item) => item.id === selectedBounty.value?.id)
      if (fresh) selectedBounty.value = fresh
    }
  } catch (error: any) {
    bounties.value = []
    bountiesError.value = contractErrorMessage(error)
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
  submissionsLoading.value = true
  submissionsError.value = ''
  try {
    submissions.value = await readSubmissionsForBounty(bountyId)
    await loadChallengeDetails(submissions.value)
    await loadVerdicts(submissions.value)
  } catch (error: any) {
    submissions.value = []
    submissionsError.value = contractErrorMessage(error)
  } finally {
    submissionsLoading.value = false
  }
}

async function loadVerdicts(records: Submission[]) {
  const loaded = await Promise.all(records.map(async (submission) => {
    try {
      const verdict = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: 'get_submission_verdict',
        args: [submission.id],
      }) as VerdictRecord
      return [submission.id, verdict] as const
    } catch {
      return null
    }
  }))
  verdicts.value = {
    ...verdicts.value,
    ...Object.fromEntries(loaded.filter((entry): entry is readonly [number, VerdictRecord] => entry !== null)),
  }
}

async function loadEscrowAccounting() {
  if (!contractConfigured.value) return
  escrowError.value = ''
  try {
    escrow.value = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_escrow_accounting',
      args: [],
    }) as EscrowAccounting
  } catch (error: any) {
    escrow.value = null
    escrowError.value = contractErrorMessage(error)
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
    const challengeWindowSeconds = Math.round(Number(postForm.value.challengeWindowHours) * 3_600)
    if (!Number.isSafeInteger(submissionSeconds) || !Number.isSafeInteger(evaluationSeconds)) {
      throw new Error('Deadline values are invalid.')
    }
    if (!Number.isSafeInteger(challengeWindowSeconds) || challengeWindowSeconds < 300 || challengeWindowSeconds > 172_800) {
      throw new Error('The dispute window must be between 5 minutes and 48 hours.')
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
        challengeWindowSeconds,
      ],
      parseGenAmount(postForm.value.reward),
    )
    if (hash) {
      postForm.value = {
        title: '', description: '', reward: '', submissionDays: '7', evaluationDays: '3', challengeWindowHours: '48',
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

async function withdrawReward(submission: Submission) {
  actionBusy.value = `withdraw-${submission.id}`
  try {
    await runWrite(
      'WITHDRAW_REWARD',
      `Withdraw reward for submission #${submission.id}`,
      submission.id,
      'withdraw_reward',
      [submission.id],
    )
    await refreshSelected()
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function withdrawRefund(bounty: Bounty) {
  actionBusy.value = 'withdraw-refund'
  try {
    await runWrite(
      'WITHDRAW_REFUND',
      `Withdraw refund for bounty #${bounty.id}`,
      bounty.id,
      'withdraw_refund',
      [bounty.id],
    )
    await refreshSelected()
  } catch (error: any) {
    showNotice(contractErrorMessage(error), 'error')
  } finally {
    actionBusy.value = ''
  }
}

async function withdrawBond(challenge: Challenge) {
  actionBusy.value = `withdraw-bond-${challenge.id}`
  try {
    await runWrite(
      'WITHDRAW_BOND',
      `Withdraw bond for challenge #${challenge.id}`,
      challenge.id,
      'withdraw_bond',
      [challenge.id],
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
  await loadEscrowAccounting()
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
  return sameAddress(bounty.poster, walletAddress.value)
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
  await loadEscrowAccounting()
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
          <p class="eyebrow">ContentBounty v2.3 · consensus adjudication</p>
          <h1>Escrow for work that can prove itself.</h1>
          <p class="hero-copy">Creators commit immutable evidence. Independent GenLayer validators render the source and judge every ordered criterion again for themselves, deterministic contract code derives the verdict, and every payout is pulled by the party it belongs to.</p>
        </div>
        <div class="hero-proof">
          <span>Equivalence rule</span>
          <strong>digest + decision + bits + bucket + reason</strong>
          <small>No model prose is stored. Verdicts are a closed set derived by contract code, and no state transition moves value.</small>
        </div>
      </section>

      <section class="metrics">
        <div><strong>{{ bounties.length }}</strong><span>known bounties</span></div>
        <div><strong>{{ openBounties }}</strong><span>accepting or evaluating</span></div>
        <div><strong>{{ formatWei(lockedValue) }} GEN</strong><span>escrow in active bounties</span></div>
        <div><strong>{{ formatWei(escrowTotal) }} GEN</strong><span>contract liability, published on chain</span></div>
      </section>

      <section v-if="activeView === 'bounties'" class="workspace">
        <div class="section-heading">
          <div><p class="eyebrow">Marketplace</p><h2>Browse bounties</h2></div>
          <button class="button secondary" :disabled="loading" @click="refreshSelected">{{ loading ? 'Loading…' : 'Refresh' }}</button>
        </div>

        <div v-if="escrow" class="escrow-strip">
          <div><span>Bounty escrow</span><strong>{{ formatWei(escrow.bounty_escrow_total) }} GEN</strong></div>
          <div><span>Rewards pending withdrawal</span><strong>{{ formatWei(escrow.reward_pending_total) }} GEN</strong></div>
          <div><span>Refunds pending withdrawal</span><strong>{{ formatWei(escrow.refund_pending_total) }} GEN</strong></div>
          <div><span>Challenge bonds held</span><strong>{{ formatWei(escrow.bond_escrowed_total + escrow.bond_pending_total) }} GEN</strong></div>
          <div class="escrow-total"><span>Contract liability</span><strong>{{ formatWei(escrow.expected_native_balance) }} GEN</strong></div>
        </div>
        <p v-else-if="escrowError" class="field-error">Escrow accounting could not be read: {{ escrowError }}</p>

        <div v-if="!contractConfigured" class="empty-card">
          <h3>Contract address required</h3>
          <p>Set <code>VITE_CONTRACT_ADDRESS</code> to the deployed v2 address. The historical v0.2 deployment is explicitly blocked as incompatible.</p>
        </div>
        <div v-else-if="loading && !bounties.length" class="empty-card"><h3>Reading the bounty index…</h3><p>The marketplace is loading from the configured contract.</p></div>
        <div v-else-if="bountiesError" class="empty-card"><h3>The bounty index could not be read</h3><p>{{ bountiesError }}</p></div>
        <div v-else-if="!bounties.length" class="empty-card"><h3>No bounties yet</h3><p>Post the first bounded rubric and escrow.</p></div>
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
              <div><dt>Dispute window</dt><dd>{{ disputeWindowLabel(selectedBounty) }}</dd></div>
              <div><dt>Escrow held</dt><dd>{{ formatWei(selectedBounty.escrow_balance) }} GEN</dd></div>
              <div><dt>Refund</dt><dd>{{ refundLabel(selectedBounty) }}</dd></div>
              <div><dt>Submissions</dt><dd>{{ selectedBounty.submission_count }}</dd></div>
            </dl>

            <div class="rubric">
              <p class="label">Ordered rubric · {{ selectedBounty.rubric_version }}</p>
              <ol><li v-for="criterion in rubricFor(selectedBounty)" :key="criterion.id"><strong>{{ criterion.id }}</strong><span>{{ criterion.requirement }}</span></li></ol>
              <p class="digest mono">rubric sha256:{{ selectedBounty.rubric_sha256 }}</p>
            </div>

            <div class="detail-actions">
              <button v-if="hasBountyAction('cancel')" class="button danger" :disabled="Boolean(actionBusy)" @click="cancelBounty(selectedBounty)">Cancel and record refund</button>
              <button v-if="hasBountyAction('expire')" class="button secondary" :disabled="Boolean(actionBusy)" @click="expireBounty(selectedBounty)">Expire permissionlessly</button>
              <button v-if="hasBountyAction('withdraw_refund')" class="button primary" :disabled="Boolean(actionBusy)" @click="withdrawRefund(selectedBounty)">{{ actionBusy === 'withdraw-refund' ? 'Withdrawing…' : 'Withdraw refund' }}</button>
            </div>

            <form v-if="hasBountyAction('submit')" class="evidence-form" @submit.prevent="submitEvidence">
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
              <div v-if="submissionsLoading" class="empty-inline">Reading submissions and their verdicts…</div>
              <div v-else-if="submissionsError" class="empty-inline">{{ submissionsError }}</div>
              <div v-else-if="!submissions.length" class="empty-inline">No submissions yet.</div>
              <article v-for="submission in submissions" :key="submission.id" class="submission-card">
                <div class="submission-head"><div><span class="mono">Submission #{{ submission.id }}</span><a :href="submission.evidence_uri" target="_blank" rel="noreferrer">Open evidence ↗</a></div><span :class="statusClass(submission.status)">{{ submission.status }}</span></div>
                <p class="digest mono">sha256:{{ submission.evidence_sha256 }}</p>
                <p v-if="submission.claim_tag" class="digest mono">claim:{{ submission.claim_tag }} · {{ submission.claim_tag_version }}</p>

                <div v-if="verdictView(submission.id)" :class="['verdict', `verdict-${verdictView(submission.id)!.tone}`]">
                  <div class="verdict-head"><strong>{{ verdictView(submission.id)!.headline }}</strong><span class="mono">{{ submission.verdict_code || 'NOT EVALUATED' }}</span></div>
                  <p>{{ verdictView(submission.id)!.detail }}</p>
                  <ul v-if="verdictView(submission.id)!.criteria.length">
                    <li v-for="criterion in verdictView(submission.id)!.criteria" :key="criterion.id">
                      <span :class="criterion.met ? 'criterion met' : 'criterion unmet'">{{ criterion.met ? 'met' : 'not met' }}</span>
                      <strong>{{ criterion.id }}</strong>
                      <span>{{ criterion.requirement }}</span>
                    </li>
                  </ul>
                </div>

                <dl class="result-grid">
                  <div><dt>Creator</dt><dd>{{ shortAddress(submission.creator) }}</dd></div>
                  <div><dt>Attempts</dt><dd>{{ submission.attempt_count }} / 3</dd></div>
                  <div><dt>Decision</dt><dd>{{ submission.decision || 'NOT EVALUATED' }}</dd></div>
                  <div><dt>Score bucket</dt><dd>{{ submission.decision ? `${submission.score_bucket} / 4` : '—' }}</dd></div>
                  <div><dt>Criteria bits</dt><dd class="mono">{{ submission.criteria_bits || '—' }}</dd></div>
                  <div><dt>Reason</dt><dd>{{ submission.reason_code || '—' }}</dd></div>
                  <div><dt>Reward</dt><dd>{{ rewardLabel(submission) }}</dd></div>
                  <div><dt>Evaluator</dt><dd class="mono">{{ submission.evaluator_version }}</dd></div>
                  <div><dt>Rubric version</dt><dd class="mono">{{ submission.rubric_version }}</dd></div>
                </dl>
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
                    <div><dt>Bond disposition</dt><dd>{{ bondDispositionLabel(challengeFor(submission)) }}</dd></div>
                  </dl>
                  <p class="digest mono">evidence: <a :href="challengeFor(submission)?.evidence_uri" target="_blank" rel="noreferrer">{{ challengeFor(submission)?.evidence_uri }}</a></p>
                  <p v-if="challengeFor(submission)?.proposed_error_class" class="feedback">{{ challengeFor(submission)?.proposed_error_class }} review result</p>
                </div>
                <div class="submission-actions">
                  <button v-if="hasSubmissionAction(submission.id, 'evaluate')" class="button secondary" :disabled="Boolean(actionBusy)" @click="evaluateSubmission(submission)">{{ actionBusy === `evaluate-${submission.id}` ? 'Evaluating…' : submission.status === 'INCONCLUSIVE' ? 'Retry evaluation' : 'Evaluate submission' }}</button>
                  <button v-if="hasSubmissionAction(submission.id, 'challenge')" class="button danger" :disabled="Boolean(actionBusy)" @click="openChallengeModal(submission)">Challenge</button>
                  <button v-if="hasSubmissionAction(submission.id, 'claim')" class="button primary" :disabled="Boolean(actionBusy)" @click="claimReward(submission)">{{ actionBusy === `claim-${submission.id}` ? 'Claiming…' : 'Claim reward' }}</button>
                  <button v-if="hasSubmissionAction(submission.id, 'withdraw_reward')" class="button primary" :disabled="Boolean(actionBusy)" @click="withdrawReward(submission)">{{ actionBusy === `withdraw-${submission.id}` ? 'Withdrawing…' : 'Withdraw reward' }}</button>
                  <button v-if="hasChallengeAction(challengeFor(submission)?.id ?? 0, 'review')" class="button secondary" :disabled="Boolean(actionBusy)" @click="reviewSubmissionChallenge(submission)">Review challenge</button>
                  <button v-if="hasChallengeAction(challengeFor(submission)?.id ?? 0, 'finalize')" class="button primary" :disabled="Boolean(actionBusy)" @click="finalizeSubmissionChallenge(submission)">Finalize challenge</button>
                  <button v-if="hasChallengeAction(challengeFor(submission)?.id ?? 0, 'timeout')" class="button secondary" :disabled="Boolean(actionBusy)" @click="timeoutSubmissionChallenge(submission)">Timeout challenge</button>
                  <button v-if="hasChallengeAction(challengeFor(submission)?.id ?? 0, 'withdraw_bond')" class="button primary" :disabled="Boolean(actionBusy)" @click="withdrawSubmissionChallenge(submission)">Withdraw bond</button>
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
            <label>Dispute window (hours)<input v-model="postForm.challengeWindowHours" required type="number" min="0.0833333333" max="48" step="0.25" /></label>
          </div>
          <p class="hint">The dispute window is stored on the bounty when it is posted and cannot be changed afterwards. Creators see the exact window on the bounty before they submit. The contract accepts 5 minutes to 48 hours.</p>
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
            <p class="feedback">{{ verdictView(submission.id)?.headline ?? 'Not evaluated yet.' }}</p>
            <p v-if="verdictView(submission.id)" class="feedback">{{ verdictView(submission.id)?.detail }}</p>
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
      <div><strong>ContentBounty v2.3</strong><span>{{ NETWORK_LABEL }} ({{ NETWORK_SELECTOR }}) · {{ RPC_URL }}</span></div>
      <div><a v-if="contractConfigured" :href="`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`" target="_blank" rel="noreferrer">Contract {{ shortAddress(CONTRACT_ADDRESS) }} ↗</a><span v-else>v2 contract not configured</span><span>External signer only</span></div>
    </footer>
  </div>
</template>
