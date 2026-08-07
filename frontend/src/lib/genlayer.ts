import { studionet } from 'genlayer-js/chains'

const configuredRpc = (import.meta.env.VITE_GENLAYER_RPC_URL as string | undefined)?.trim()

export const RPC_URL = configuredRpc || studionet.rpcUrls.default.http[0]
export const NETWORK = configuredRpc
  ? {
      ...studionet,
      rpcUrls: {
        ...studionet.rpcUrls,
        default: { ...studionet.rpcUrls.default, http: [RPC_URL] as const },
      },
    }
  : studionet

export const NETWORK_LABEL = (import.meta.env.VITE_GENLAYER_NETWORK_LABEL as string | undefined)?.trim() || NETWORK.name
export const CONTRACT_ADDRESS = ((import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined)?.trim() || '') as `0x${string}`
export const HISTORICAL_V0_2_ADDRESS = '0xFf546d6B1CD45d2859a705a7FA181807670B9015'
export const EXPLORER_URL = ((import.meta.env.VITE_GENLAYER_EXPLORER_URL as string | undefined)?.trim()
  || NETWORK.blockExplorers?.default.url
  || 'https://explorer-studio.genlayer.com').replace(/\/$/, '')

export const walletChainParameters = {
  chainId: `0x${Number(NETWORK.id).toString(16)}`,
  chainName: NETWORK.name,
  nativeCurrency: NETWORK.nativeCurrency,
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [EXPLORER_URL],
}
