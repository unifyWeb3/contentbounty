import { createHash } from 'node:crypto'
import { normalizeLiveEvidence } from './live-adversarial-fixture.mjs'
import { reconcileMutationState } from './live-mutation-state.mjs'
import { COMPROMISED_DEPLOYER_ADDRESSES, assertSafeDeployerAddress } from './deployer-guard.mjs'

export const EXPOSED_DEPLOYER_ADDRESSES = COMPROMISED_DEPLOYER_ADDRESSES

const DEFAULT_GAS_RESERVE_WEI = 10_000_000_000_000_000n

async function withTransientRetries(operation, {
  retries = 5,
  interval = 2000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= retries) throw error
      attempt += 1
      await sleep(interval)
    }
  }
}

function httpsUrl(value, label) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error()
    return url
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`)
  }
}

async function fetchText(fetchImpl, url, label, retryOptions) {
  let response
  try {
    response = await withTransientRetries(() => fetchImpl(url), retryOptions)
  } catch (error) {
    throw new Error(`${label} request failed: ${error?.message ?? error}`)
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`)
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('text/plain')) {
    throw new Error(`${label} must return text/plain, got ${contentType || 'missing content type'}`)
  }
  return response.text()
}

export async function preflightLiveRun({
  network,
  proofMode,
  deployer,
  creator,
  deployerClient,
  creatorClient,
  reward,
  approvalUri,
  rejectionUri,
  mutableUri,
  mutationWebhookUrl,
  adversarialFixture,
  gasReserveWei = DEFAULT_GAS_RESERVE_WEI,
  fetchImpl = fetch,
  transientRetries = 5,
  transientRetryInterval = 2000,
  sleep,
  mutationCheckpoint,
}) {
  if (network !== 'testnetBradbury' || proofMode !== 'persistent') {
    throw new Error('Persistent recovery preflight requires testnetBradbury with LIVE_PROOF_MODE=persistent')
  }
  const deployerAddress = deployer.address.toLowerCase()
  const creatorAddress = creator.address.toLowerCase()
  if (deployerAddress === creatorAddress) throw new Error('Live deployer and creator accounts must be distinct')
  assertSafeDeployerAddress(deployer.address)
  assertSafeDeployerAddress(creator.address, 'creator signer')

  const approvalUrl = httpsUrl(approvalUri, 'LIVE_APPROVE_EVIDENCE_URI')
  const rejectionUrl = httpsUrl(rejectionUri, 'LIVE_REJECT_EVIDENCE_URI')
  const mutableUrl = httpsUrl(mutableUri, 'LIVE_MUTABLE_EVIDENCE_URI')
  httpsUrl(mutationWebhookUrl, 'LIVE_MUTATION_WEBHOOK_URL')
  const healthUrl = new URL('/healthz', mutableUrl)

  const reserve = BigInt(gasReserveWei)
  const requiredDeployerBalance = BigInt(reward) * 3n + reserve
  const requiredCreatorBalance = reserve
  let deployerBalance
  let creatorBalance
  try {
    ;[deployerBalance, creatorBalance] = await Promise.all([
      withTransientRetries(
        () => deployerClient.getBalance({ address: deployer.address }),
        { retries: transientRetries, interval: transientRetryInterval, sleep },
      ),
      withTransientRetries(
        () => creatorClient.getBalance({ address: creator.address }),
        { retries: transientRetries, interval: transientRetryInterval, sleep },
      ),
    ])
  } catch (error) {
    throw new Error(`Bradbury balance preflight failed: ${error?.message ?? error}`)
  }
  if (deployerBalance < requiredDeployerBalance) {
    throw new Error(`Rotated deployer is underfunded: requires at least ${requiredDeployerBalance} wei, has ${deployerBalance} wei`)
  }
  if (creatorBalance < requiredCreatorBalance) {
    throw new Error(`Creator is underfunded: requires at least ${requiredCreatorBalance} wei, has ${creatorBalance} wei`)
  }

  const retryOptions = { retries: transientRetries, interval: transientRetryInterval, sleep }
  const [approvalText, rejectionText, mutableText, healthResponse] = await Promise.all([
    fetchText(fetchImpl, approvalUrl, 'Approval evidence', retryOptions),
    fetchText(fetchImpl, rejectionUrl, 'Rejection evidence', retryOptions),
    fetchText(fetchImpl, mutableUrl, 'Mutable evidence', retryOptions),
    withTransientRetries(() => fetchImpl(healthUrl), retryOptions),
  ])
  if (!healthResponse.ok) throw new Error(`Evidence health check returned HTTP ${healthResponse.status}`)
  let health
  try {
    health = await healthResponse.json()
  } catch {
    throw new Error('Evidence health check returned malformed JSON')
  }
  const mutation = reconcileMutationState(mutationCheckpoint, health.mutableState, mutableUri)
  if (!approvalText.includes('CONTENT BOUNTY LIVE PASS') || !approvalText.includes('https://docs.genlayer.com/')) {
    throw new Error('Approval evidence is missing one or more required live-rubric facts')
  }
  const normalizedRejection = normalizeLiveEvidence(rejectionText)
  const rejectionSha256 = createHash('sha256').update(normalizedRejection, 'utf8').digest('hex')
  if (rejectionSha256 !== adversarialFixture.expectedNormalizedSha256) {
    throw new Error(`Rejection evidence SHA-256 mismatch: expected ${adversarialFixture.expectedNormalizedSha256}, got ${rejectionSha256}`)
  }
  if (normalizedRejection.length !== adversarialFixture.characterCount) {
    throw new Error(`Rejection evidence character-count mismatch: expected ${adversarialFixture.characterCount}, got ${normalizedRejection.length}`)
  }
  if (!normalizeLiveEvidence(mutableText)) throw new Error('Mutable evidence is empty before submission')

  return {
    checkedAt: new Date().toISOString(),
    deployer: deployer.address,
    creator: creator.address,
    deployerBalance: deployerBalance.toString(),
    creatorBalance: creatorBalance.toString(),
    requiredDeployerBalance: requiredDeployerBalance.toString(),
    requiredCreatorBalance: requiredCreatorBalance.toString(),
    health: { mutableState: health.mutableState },
    rejection: { normalizedSha256: rejectionSha256, characterCount: normalizedRejection.length },
    approvalFactsVerified: true,
    mutableEvidenceInitial: health.mutableState === 'initial',
    mutationWebhookCalled: mutation.state === 'CONFIRMED',
    mutationState: mutation,
  }
}
