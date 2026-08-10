import { studionet, testnetBradbury } from 'genlayer-js/chains'

export const DEFAULT_GENLAYER_NETWORK = 'testnetBradbury'

export const SUPPORTED_GENLAYER_NETWORKS = {
  studionet,
  testnetBradbury,
} as const

export type SupportedGenLayerNetwork = keyof typeof SUPPORTED_GENLAYER_NETWORKS

export function selectGenLayerNetwork(configured?: string) {
  const selector = configured?.trim() || DEFAULT_GENLAYER_NETWORK
  if (!Object.prototype.hasOwnProperty.call(SUPPORTED_GENLAYER_NETWORKS, selector)) {
    throw new Error(
      `Unsupported GenLayer network "${selector}". Expected one of: ${Object.keys(SUPPORTED_GENLAYER_NETWORKS).join(', ')}.`,
    )
  }
  const name = selector as SupportedGenLayerNetwork
  return { name, chain: SUPPORTED_GENLAYER_NETWORKS[name] }
}
