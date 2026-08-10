import { describe, expect, it, vi } from 'vitest'
import { encodeFunctionResult, type Abi } from 'viem'
import { studionet, testnetBradbury } from 'genlayer-js/chains'
import type { GenLayerChain } from 'genlayer-js/types'
import {
  MAX_SHARED_CHAIN_HEAD_LAG,
  runVerifiedWalletWrite,
  SHARED_CHAIN_CONFIRMATION_MARGIN,
  verifyInjectedWalletNetwork,
  type EthereumProvider,
  type RpcRequest,
} from './walletNetwork'

const blockHash = `0x${'ab'.repeat(32)}`
const otherBlockHash = `0x${'cd'.repeat(32)}`
const latestCommonTag = '0x20'
const confirmedTag = `0x${(0x20n - SHARED_CHAIN_CONFIRMATION_MARGIN).toString(16)}`

function consensusCallResult(chain: GenLayerChain): string {
  const abi = chain.consensusMainContract!.abi as Abi
  if (abi.some((item) => item.type === 'function' && item.name === 'VERSION')) {
    return encodeFunctionResult({ abi, functionName: 'VERSION', result: '2.0.0' })
  }
  const addressWord = (suffix: string) => `${'0'.repeat(24)}${suffix.padStart(40, '0')}`
  return `0x${Array.from({ length: 8 }, (_item, index) => addressWord((index + 1).toString(16))).join('')}`
}

type ProviderOptions = {
  chainId?: string
  height?: string
  code?: string | ((tag: string) => string)
  probe?: string | ((tag: string) => string)
  blockHash?: string | ((tag: string) => string)
  failMethod?: string
}

function responseFor(value: string | ((tag: string) => string) | undefined, tag: string, fallback: string) {
  return typeof value === 'function' ? value(tag) : value ?? fallback
}

function providerFor(chain: GenLayerChain, options: ProviderOptions = {}): EthereumProvider {
  return {
    async request({ method, params }) {
      if (options.failMethod === method) throw new Error(`${method} unavailable`)
      if (method === 'eth_chainId') return options.chainId ?? `0x${chain.id.toString(16)}`
      if (method === 'eth_blockNumber') return options.height ?? '0x20'
      if (method === 'eth_getBlockByNumber') {
        const tag = String(params?.[0] ?? '')
        return { hash: responseFor(options.blockHash, tag, blockHash) }
      }
      if (method === 'eth_getCode') {
        const tag = String(params?.[1] ?? '')
        return responseFor(options.code, tag, '0x60006000')
      }
      if (method === 'eth_call') {
        const tag = String(params?.[1] ?? '')
        return responseFor(options.probe, tag, consensusCallResult(chain))
      }
      throw new Error(`Unexpected provider method ${method}`)
    },
  }
}

function referenceFor(chain: GenLayerChain, options: ProviderOptions = {}): RpcRequest {
  return vi.fn(async (method, params = []) => {
    if (options.failMethod === method) throw new Error(`${method} unavailable`)
    if (method === 'eth_blockNumber') return options.height ?? '0x20'
    if (method === 'eth_getBlockByNumber') {
      const tag = String(params[0] ?? '')
      return { hash: responseFor(options.blockHash, tag, blockHash) }
    }
    if (method === 'eth_getCode') {
      const tag = String(params[1] ?? '')
      return responseFor(options.code, tag, '0x60006000')
    }
    if (method === 'eth_call') {
      const tag = String(params[1] ?? '')
      return responseFor(options.probe, tag, consensusCallResult(chain))
    }
    throw new Error(`Unexpected reference method ${method}`)
  })
}

describe('verifyInjectedWalletNetwork', () => {
  it('verifies a correct Studionet provider through code and getContracts', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(studionet),
      'studionet',
      studionet,
      referenceFor(studionet),
    )).resolves.toMatchObject({
      chainId: '0xf22f',
      consensusAddress: studionet.consensusMainContract!.address,
      consensusProbe: 'getContracts',
    })
  })

  it('verifies equal latest-common history plus matching bytecode and probe', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury),
    )).resolves.toMatchObject({
      chainId: '0x107d',
      consensusAddress: testnetBradbury.consensusMainContract!.address,
      consensusProbe: 'VERSION',
      consensusVersion: '2.0.0',
      referenceConsensusVersion: '2.0.0',
      latestCommonBlockNumber: latestCommonTag,
      latestCommonBlockHash: blockHash,
      confirmedBlockNumber: confirmedTag,
      confirmedBlockHash: blockHash,
      comparedBlockNumber: latestCommonTag,
      comparedBlockHash: blockHash,
      comparedHeadLag: '0',
    })
  })

  it.each([
    ['wallet one block behind', '0x1f', '0x20'],
    ['wallet a few blocks behind', '0x1d', '0x20'],
    ['reference one block behind', '0x20', '0x1f'],
    ['reference a few blocks behind', '0x20', '0x1d'],
  ])('accepts %s when latest-common history matches', async (_label, walletHeight, referenceHeight) => {
    const wallet = providerFor(testnetBradbury, { height: walletHeight })
    const reference = referenceFor(testnetBradbury, { height: referenceHeight })
    await expect(verifyInjectedWalletNetwork(wallet, 'testnetBradbury', testnetBradbury, reference))
      .resolves.toMatchObject({
        latestCommonBlockNumber: `0x${BigInt(walletHeight) < BigInt(referenceHeight)
          ? BigInt(walletHeight).toString(16)
          : BigInt(referenceHeight).toString(16)}`,
        comparedHeadLag: expect.any(String),
      })
  })

  it('handles a block produced between height requests when latest-common history matches', async () => {
    const wallet = providerFor(testnetBradbury, { height: '0x20' })
    const reference = referenceFor(testnetBradbury, { height: '0x21' })
    await expect(verifyInjectedWalletNetwork(wallet, 'testnetBradbury', testnetBradbury, reference))
      .resolves.toMatchObject({ latestCommonBlockNumber: latestCommonTag, latestCommonBlockHash: blockHash })
  })

  it('rejects matching older history with a different latest-common hash', async () => {
    const wallet = providerFor(testnetBradbury, {
      height: '0x20',
      blockHash: (tag) => tag === confirmedTag ? blockHash : otherBlockHash,
    })
    const reference = referenceFor(testnetBradbury, {
      height: '0x21',
      blockHash: () => blockHash,
    })
    await expect(verifyInjectedWalletNetwork(wallet, 'testnetBradbury', testnetBradbury, reference))
      .rejects.toMatchObject({
        code: 'AMBIGUOUS_SHARED_CHAIN',
        message: expect.stringContaining('latest common block'),
      })
  })

  it.each([
    ['wallet head is behind', '0x1f', '0x20'],
    ['official head is behind', '0x20', '0x1f'],
  ])('rejects a recent fork when %s', async (_label, walletHeight, referenceHeight) => {
    const commonTag = '0x1f'
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury, {
        height: walletHeight,
        blockHash: (tag) => tag === commonTag ? otherBlockHash : blockHash,
      }),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury, { height: referenceHeight }),
    )).rejects.toMatchObject({
      code: 'AMBIGUOUS_SHARED_CHAIN',
      message: expect.stringContaining('latest common block 0x1f'),
    })
  })

  it('uses the latest-common block tag for both consensus identity probes', async () => {
    const walletCalls: Array<{ method: string; params?: unknown[] }> = []
    const referenceCalls: Array<{ method: string; params?: unknown[] }> = []
    const wallet = providerFor(testnetBradbury)
    const originalWalletRequest = wallet.request.bind(wallet)
    wallet.request = async (args) => {
      walletCalls.push({
        method: args.method,
        params: Array.isArray(args.params) ? args.params : undefined,
      })
      return originalWalletRequest(args)
    }
    const reference = referenceFor(testnetBradbury)
    const originalReference = reference
    const observedReference = vi.fn(async (method: string, params: unknown[] = []) => {
      referenceCalls.push({ method, params })
      return originalReference(method, params)
    })
    await verifyInjectedWalletNetwork(wallet, 'testnetBradbury', testnetBradbury, observedReference)
    expect(walletCalls.filter((call) => ['eth_getCode', 'eth_call'].includes(call.method)).every((call) => {
      const params = call.params ?? []
      return params[params.length - 1] === latestCommonTag
    })).toBe(true)
    expect(referenceCalls.filter((call) => ['eth_getCode', 'eth_call'].includes(call.method)).every((call) => {
      const params = call.params ?? []
      return params[params.length - 1] === latestCommonTag
    })).toBe(true)
  })

  it('rejects excessive head lag', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury, { height: '0x20' }),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury, { height: `0x${(0x20n + MAX_SHARED_CHAIN_HEAD_LAG + 1n).toString(16)}` }),
    )).rejects.toMatchObject({ code: 'AMBIGUOUS_SHARED_CHAIN', message: expect.stringContaining('exceeding') })
  })

  it('rejects matching heights with different block hashes', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury, { blockHash: blockHash }),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury, { blockHash: otherBlockHash }),
    )).rejects.toMatchObject({ code: 'AMBIGUOUS_SHARED_CHAIN' })
  })

  it('rejects different hashes at the confirmed continuity block', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury, { blockHash: (tag) => tag === confirmedTag ? otherBlockHash : blockHash }),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury),
    )).rejects.toMatchObject({ code: 'AMBIGUOUS_SHARED_CHAIN', message: expect.stringContaining('confirmed continuity block') })
  })

  it('rejects a latest-common Bradbury consensus bytecode mismatch', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury, { code: '0x60016001' }),
    )).rejects.toMatchObject({ code: 'CONSENSUS_IDENTITY_MISMATCH', message: expect.stringContaining('bytecode') })
  })

  it('rejects a latest-common Bradbury VERSION result mismatch', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury, { probe: encodeFunctionResult({ abi: testnetBradbury.consensusMainContract!.abi as Abi, functionName: 'VERSION', result: '9.9.9' }) }),
    )).rejects.toMatchObject({ code: 'CONSENSUS_IDENTITY_MISMATCH', message: expect.stringContaining('ABI probe') })
  })

  it('fails closed on a malformed official JSON-RPC result', async () => {
    const malformedReference: RpcRequest = async (method) => {
      if (method === 'eth_blockNumber') return {}
      return { hash: blockHash }
    }
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury),
      'testnetBradbury',
      testnetBradbury,
      malformedReference,
    )).rejects.toMatchObject({ code: 'AMBIGUOUS_SHARED_CHAIN' })
  })

  it('rejects a chain ID mismatch', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(studionet, { chainId: '0x1' }),
      'studionet',
      studionet,
      referenceFor(studionet),
    )).rejects.toMatchObject({ code: 'CHAIN_ID_MISMATCH' })
  })

  it('rejects a missing selected consensus contract', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury, { code: '0x' }),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury),
    )).rejects.toMatchObject({ code: 'CONSENSUS_CODE_MISSING' })
  })

  it.each(['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'])('fails closed when wallet %s fails', async (failMethod) => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury, { failMethod }),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury),
    )).rejects.toMatchObject({ code: 'RPC_FAILURE' })
  })

  it.each(['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'])('fails closed when official %s fails', async (failMethod) => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(testnetBradbury, { failMethod }),
    )).rejects.toMatchObject({ code: 'RPC_FAILURE' })
  })
})

describe('runVerifiedWalletWrite', () => {
  it.each([
    ['payable', 1n],
    ['nonpayable', 0n],
  ] as const)('blocks a %s write before writeContract when identity is ambiguous', async (_label, value) => {
    const writeContract = vi.fn(async (_request: { value: bigint }) => '0xtransaction')
    await expect(runVerifiedWalletWrite({
      provider: providerFor(testnetBradbury, {
        blockHash: (tag) => tag === latestCommonTag ? otherBlockHash : blockHash,
      }),
      networkSelector: 'testnetBradbury',
      chain: testnetBradbury,
      referenceRequest: referenceFor(testnetBradbury),
      write: () => writeContract({ value }),
    })).rejects.toMatchObject({ code: 'AMBIGUOUS_SHARED_CHAIN' })
    expect(writeContract).not.toHaveBeenCalled()
  })
})
