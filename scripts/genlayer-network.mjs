import { studionet, testnetAsimov, testnetBradbury } from 'genlayer-js/chains'

export const DEFAULT_GENLAYER_NETWORK = 'studionet'

export const SUPPORTED_GENLAYER_NETWORKS = Object.freeze({
  studionet,
  testnetAsimov,
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
