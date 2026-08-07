import { selectGenLayerNetwork } from './networkSelection'

const selectedNetwork = selectGenLayerNetwork(import.meta.env.VITE_GENLAYER_NETWORK as string | undefined)

export const NETWORK_SELECTOR = selectedNetwork.name
export const NETWORK = selectedNetwork.chain
export const NETWORK_LABEL = NETWORK.name
export const RPC_URL = NETWORK.rpcUrls.default.http[0]
export const CONTRACT_ADDRESS = ((import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined)?.trim() || '') as `0x${string}`
export const HISTORICAL_V0_2_ADDRESS = '0xFf546d6B1CD45d2859a705a7FA181807670B9015'
export const EXPLORER_URL = NETWORK.blockExplorers.default.url.replace(/\/$/, '')

export const walletChainParameters = {
  chainId: `0x${Number(NETWORK.id).toString(16)}`,
  chainName: NETWORK.name,
  nativeCurrency: NETWORK.nativeCurrency,
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [EXPLORER_URL],
}
