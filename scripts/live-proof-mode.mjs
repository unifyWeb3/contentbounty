export const PERSISTENT_PROOF_MODE = 'persistent'
export const STUDIONET_SMOKE_PROOF_MODE = 'studionet-smoke'

const PERSISTENT_NETWORK = 'testnetBradbury'

export function selectLiveProofMode(network, configuredMode) {
  if (!network || !network.trim()) {
    throw new Error('LIVE_GENLAYER_NETWORK is required; choose testnetBradbury for persistent proof.')
  }
  if (!configuredMode || !configuredMode.trim()) {
    throw new Error(
      'LIVE_PROOF_MODE is required. Use persistent for testnetBradbury or studionet-smoke for a simulated Studionet demo.',
    )
  }

  const mode = configuredMode.trim()
  if (network === 'studionet') {
    if (mode !== STUDIONET_SMOKE_PROOF_MODE) {
      throw new Error(
        'Studionet is available only as LIVE_PROOF_MODE=studionet-smoke; its balances and transfers are simulated and cannot satisfy the persistent payout-proof gate.',
      )
    }
    return {
      network,
      mode,
      persistent: false,
      balancesSimulated: true,
      persistentPayoutProofEligible: false,
    }
  }

  if (network === PERSISTENT_NETWORK) {
    if (mode !== PERSISTENT_PROOF_MODE) {
      throw new Error(
        `${network} live verification requires LIVE_PROOF_MODE=persistent; Studionet smoke mode is not a testnet settlement proof.`,
      )
    }
    return {
      network,
      mode,
      persistent: true,
      balancesSimulated: false,
      persistentPayoutProofEligible: true,
    }
  }

  throw new Error(
    `Unsupported live proof network "${network}". Choose testnetBradbury for persistent proof or explicitly use studionet-smoke with studionet.`,
  )
}
