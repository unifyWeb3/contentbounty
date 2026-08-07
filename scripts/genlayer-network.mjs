import { studionet, testnetBradbury } from 'genlayer-js/chains'

export const DEFAULT_GENLAYER_NETWORK = 'studionet'
export const PERSISTENT_DEPLOYMENT_MODE = 'persistent'
export const STUDIONET_SMOKE_DEPLOYMENT_MODE = 'studionet-smoke'

export const SUPPORTED_GENLAYER_NETWORKS = Object.freeze({
  studionet,
  testnetBradbury,
})

export function selectGenLayerNetwork(configured) {
  const selector = configured?.trim() || DEFAULT_GENLAYER_NETWORK
  if (!Object.hasOwn(SUPPORTED_GENLAYER_NETWORKS, selector)) {
    throw new Error(
      `Unsupported GenLayer network "${selector}". Expected one of: ${Object.keys(SUPPORTED_GENLAYER_NETWORKS).join(', ')}.`,
    )
  }
  return { name: selector, chain: SUPPORTED_GENLAYER_NETWORKS[selector] }
}

export function selectDeploymentMode(network, configuredMode) {
  const mode = configuredMode?.trim()
  if (!mode) {
    throw new Error(
      'GENLAYER_DEPLOY_MODE is required. Use persistent for testnetBradbury or studionet-smoke for a simulated Studionet deployment.',
    )
  }
  if (network === 'testnetBradbury' && mode === PERSISTENT_DEPLOYMENT_MODE) {
    return { mode, persistent: true, balancesSimulated: false }
  }
  if (network === 'studionet' && mode === STUDIONET_SMOKE_DEPLOYMENT_MODE) {
    return { mode, persistent: false, balancesSimulated: true }
  }
  throw new Error(`GENLAYER_DEPLOY_MODE=${mode} is not valid for ${network}.`)
}
