import { decodeFunctionResult, encodeFunctionData, type Abi } from 'viem'
import type { GenLayerChain } from 'genlayer-js/types'

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
}

export type RpcRequest = (method: string, params?: unknown[]) => Promise<unknown>

export interface WalletNetworkVerification {
  chainId: string
  consensusAddress: string
  consensusProbe: 'VERSION' | 'getContracts'
  consensusVersion?: string
  comparedBlockNumber?: string
  comparedBlockHash?: string
}

export class WalletNetworkPreflightError extends Error {
  constructor(
    public readonly code:
      | 'CHAIN_ID_MISMATCH'
      | 'CONSENSUS_CODE_MISSING'
      | 'CONSENSUS_PROBE_FAILED'
      | 'AMBIGUOUS_SHARED_CHAIN'
      | 'RPC_FAILURE',
    message: string,
  ) {
    super(message)
    this.name = 'WalletNetworkPreflightError'
  }
}

const SHARED_TESTNET_CHAIN_ID = 4221

function expectedChainId(chain: GenLayerChain) {
  return `0x${Number(chain.id).toString(16)}`
}

function normalizeHex(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isNonemptyCode(value: unknown): value is string {
  const code = normalizeHex(value)
  return /^0x[0-9a-f]+$/.test(code) && code.length > 2 && code.length % 2 === 0
}

function parseHexQuantity(value: unknown, label: string): bigint {
  const normalized = normalizeHex(value)
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${label} returned an invalid hex quantity`)
  }
  return BigInt(normalized)
}

function blockHash(value: unknown, label: string): string {
  if (!value || typeof value !== 'object') throw new Error(`${label} returned no block`)
  const hash = normalizeHex((value as { hash?: unknown }).hash)
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error(`${label} returned an invalid block hash`)
  return hash
}

function sharedChainInstruction(networkSelector: string, chain: GenLayerChain) {
  return `Change the wallet's chain-4221 RPC to ${chain.rpcUrls.default.http[0]} for ${networkSelector}, then retry. The transaction was blocked before signing.`
}

async function providerRequest(
  provider: EthereumProvider,
  method: string,
  params: unknown[] | undefined,
  networkSelector: string,
): Promise<unknown> {
  try {
    return await provider.request({ method, params })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new WalletNetworkPreflightError(
      'RPC_FAILURE',
      `The injected wallet could not complete ${method} while verifying ${networkSelector}: ${detail}. No transaction was sent.`,
    )
  }
}

export function createSelectedNetworkRpcRequest(
  chain: GenLayerChain,
  fetchImplementation: typeof fetch = fetch,
): RpcRequest {
  let requestId = 0
  return async (method, params = []) => {
    const response = await fetchImplementation(chain.rpcUrls.default.http[0], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json() as { result?: unknown; error?: { message?: string } }
    if (body.error) throw new Error(body.error.message || 'JSON-RPC error')
    return body.result
  }
}

function consensusProbe(chain: GenLayerChain) {
  const contract = chain.consensusMainContract
  if (!contract) throw new Error('The selected SDK chain has no consensus contract')
  const abi = contract.abi as Abi
  const hasVersion = abi.some((item) => item.type === 'function' && item.name === 'VERSION')
  const functionName = hasVersion ? 'VERSION' : 'getContracts'
  if (!abi.some((item) => item.type === 'function' && item.name === functionName)) {
    throw new Error('The selected consensus ABI has no supported identity probe')
  }
  return {
    abi,
    functionName: functionName as 'VERSION' | 'getContracts',
    data: encodeFunctionData({ abi, functionName }),
  }
}

function validateConsensusProbeResult(
  chain: GenLayerChain,
  functionName: 'VERSION' | 'getContracts',
  value: unknown,
): string | undefined {
  const result = normalizeHex(value)
  if (!/^0x[0-9a-f]+$/.test(result) || result === '0x') {
    throw new Error(`${functionName} returned no ABI data`)
  }
  const decoded = decodeFunctionResult({
    abi: chain.consensusMainContract!.abi as Abi,
    functionName,
    data: result as `0x${string}`,
  })
  if (functionName === 'VERSION') {
    if (typeof decoded !== 'string' || !decoded.trim()) throw new Error('VERSION returned an empty value')
    return decoded.trim()
  }
  if (!decoded || typeof decoded !== 'object') throw new Error('getContracts returned an invalid value')
  return undefined
}

async function verifySharedChainHistory(
  provider: EthereumProvider,
  networkSelector: string,
  chain: GenLayerChain,
  referenceRequest: RpcRequest,
) {
  try {
    const [walletHeightValue, referenceHeightValue] = await Promise.all([
      providerRequest(provider, 'eth_blockNumber', undefined, networkSelector),
      referenceRequest('eth_blockNumber'),
    ])
    const walletHeight = parseHexQuantity(walletHeightValue, 'Injected wallet eth_blockNumber')
    const referenceHeight = parseHexQuantity(referenceHeightValue, 'Selected network eth_blockNumber')
    if (walletHeight !== referenceHeight) {
      throw new WalletNetworkPreflightError(
        'AMBIGUOUS_SHARED_CHAIN',
        `The wallet's chain-4221 head (${walletHeight}) does not exactly match the selected ${networkSelector} RPC head (${referenceHeight}). ${sharedChainInstruction(networkSelector, chain)}`,
      )
    }
    const blockNumber = `0x${walletHeight.toString(16)}`
    const [walletBlock, referenceBlock] = await Promise.all([
      providerRequest(provider, 'eth_getBlockByNumber', [blockNumber, false], networkSelector),
      referenceRequest('eth_getBlockByNumber', [blockNumber, false]),
    ])
    const walletHash = blockHash(walletBlock, 'Injected wallet eth_getBlockByNumber')
    const referenceHash = blockHash(referenceBlock, 'Selected network eth_getBlockByNumber')
    if (walletHash !== referenceHash) {
      throw new WalletNetworkPreflightError(
        'AMBIGUOUS_SHARED_CHAIN',
        `The wallet reports chain ID 4221, but its recent block history does not match ${networkSelector}. ${sharedChainInstruction(networkSelector, chain)}`,
      )
    }
    return { blockNumber, blockHash: walletHash }
  } catch (error) {
    if (error instanceof WalletNetworkPreflightError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new WalletNetworkPreflightError(
      'AMBIGUOUS_SHARED_CHAIN',
      `The wallet's chain-4221 RPC could not be distinguished as ${networkSelector}: ${detail}. ${sharedChainInstruction(networkSelector, chain)}`,
    )
  }
}

export async function verifyInjectedWalletNetwork(
  provider: EthereumProvider,
  networkSelector: string,
  chain: GenLayerChain,
  referenceRequest: RpcRequest = createSelectedNetworkRpcRequest(chain),
): Promise<WalletNetworkVerification> {
  const expected = expectedChainId(chain)
  const current = normalizeHex(await providerRequest(provider, 'eth_chainId', undefined, networkSelector))
  if (current !== expected) {
    throw new WalletNetworkPreflightError(
      'CHAIN_ID_MISMATCH',
      `Wallet chain ID ${current || 'UNKNOWN'} does not match ${networkSelector} (${expected}). No transaction was sent.`,
    )
  }

  const consensusAddress = chain.consensusMainContract?.address
  if (!consensusAddress) {
    throw new WalletNetworkPreflightError(
      'CONSENSUS_PROBE_FAILED',
      `The selected ${networkSelector} SDK chain has no consensus contract. No transaction was sent.`,
    )
  }
  const code = await providerRequest(
    provider,
    'eth_getCode',
    [consensusAddress, 'latest'],
    networkSelector,
  )
  if (!isNonemptyCode(code)) {
    const instruction = chain.id === SHARED_TESTNET_CHAIN_ID
      ? ` ${sharedChainInstruction(networkSelector, chain)}`
      : ' Switch the wallet to the configured GenLayer network and retry.'
    throw new WalletNetworkPreflightError(
      'CONSENSUS_CODE_MISSING',
      `No deployed code was found at the official ${networkSelector} consensus contract ${consensusAddress}.${instruction}`,
    )
  }

  const probe = consensusProbe(chain)
  let consensusVersion: string | undefined
  try {
    const probeResult = await providerRequest(
      provider,
      'eth_call',
      [{ to: consensusAddress, data: probe.data }, 'latest'],
      networkSelector,
    )
    consensusVersion = validateConsensusProbeResult(chain, probe.functionName, probeResult)
  } catch (error) {
    if (error instanceof WalletNetworkPreflightError && error.code === 'RPC_FAILURE') throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new WalletNetworkPreflightError(
      'CONSENSUS_PROBE_FAILED',
      `The contract at ${consensusAddress} did not pass the official ${probe.functionName} ABI probe for ${networkSelector}: ${detail}. No transaction was sent.`,
    )
  }

  const verification: WalletNetworkVerification = {
    chainId: current,
    consensusAddress,
    consensusProbe: probe.functionName,
    consensusVersion,
  }
  if (chain.id === SHARED_TESTNET_CHAIN_ID) {
    const comparison = await verifySharedChainHistory(
      provider,
      networkSelector,
      chain,
      referenceRequest,
    )
    verification.comparedBlockNumber = comparison.blockNumber
    verification.comparedBlockHash = comparison.blockHash
  }
  return verification
}

export async function runVerifiedWalletWrite<T>(options: {
  provider: EthereumProvider
  networkSelector: string
  chain: GenLayerChain
  write: () => Promise<T>
  referenceRequest?: RpcRequest
}): Promise<T> {
  await verifyInjectedWalletNetwork(
    options.provider,
    options.networkSelector,
    options.chain,
    options.referenceRequest,
  )
  return options.write()
}
