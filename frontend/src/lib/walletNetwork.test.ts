import { describe, expect, it, vi } from 'vitest'
import { encodeFunctionResult, type Abi } from 'viem'
import { studionet, testnetAsimov, testnetBradbury } from 'genlayer-js/chains'
import type { GenLayerChain } from 'genlayer-js/types'
import {
  runVerifiedWalletWrite,
  verifyInjectedWalletNetwork,
  type EthereumProvider,
  type RpcRequest,
} from './walletNetwork'

const blockHash = `0x${'ab'.repeat(32)}`
const otherBlockHash = `0x${'cd'.repeat(32)}`

function consensusCallResult(chain: GenLayerChain): string {
  const abi = chain.consensusMainContract!.abi as Abi
  if (abi.some((item) => item.type === 'function' && item.name === 'VERSION')) {
    return encodeFunctionResult({ abi, functionName: 'VERSION', result: '2.0.0' })
  }
  const addressWord = (suffix: string) => `${'0'.repeat(24)}${suffix.padStart(40, '0')}`
  return `0x${Array.from({ length: 8 }, (_item, index) => addressWord((index + 1).toString(16))).join('')}`
}

function providerFor(chain: GenLayerChain, options: {
  chainId?: string
  code?: string
  block?: string
  failMethod?: string
} = {}): EthereumProvider {
  return {
    async request({ method, params }) {
      if (options.failMethod === method) throw new Error(`${method} unavailable`)
      if (method === 'eth_chainId') return options.chainId ?? `0x${chain.id.toString(16)}`
      if (method === 'eth_getCode') {
        expect(params?.[0]).toBe(chain.consensusMainContract!.address)
        return options.code ?? '0x60006000'
      }
      if (method === 'eth_call') {
        expect((params?.[0] as { to: string }).to).toBe(chain.consensusMainContract!.address)
        return consensusCallResult(chain)
      }
      if (method === 'eth_blockNumber') return '0x20'
      if (method === 'eth_getBlockByNumber') return { hash: options.block ?? blockHash }
      throw new Error(`Unexpected provider method ${method}`)
    },
  }
}

function referenceFor(hash = blockHash, height = '0x20'): RpcRequest {
  return vi.fn(async (method) => {
    if (method === 'eth_blockNumber') return height
    if (method === 'eth_getBlockByNumber') return { hash }
    throw new Error(`Unexpected reference method ${method}`)
  })
}

describe('verifyInjectedWalletNetwork', () => {
  it('verifies a correct Studionet provider through code and getContracts', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(studionet),
      'studionet',
      studionet,
      referenceFor(),
    )).resolves.toMatchObject({
      chainId: '0xf22f',
      consensusAddress: studionet.consensusMainContract!.address,
      consensusProbe: 'getContracts',
    })
  })

  it.each([
    ['testnetAsimov', testnetAsimov],
    ['testnetBradbury', testnetBradbury],
  ] as const)('verifies a correct %s provider with shared-chain history', async (name, chain) => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(chain),
      name,
      chain,
      referenceFor(),
    )).resolves.toMatchObject({
      chainId: '0x107d',
      consensusAddress: chain.consensusMainContract!.address,
      consensusProbe: 'VERSION',
      consensusVersion: '2.0.0',
      comparedBlockNumber: '0x20',
      comparedBlockHash: blockHash,
    })
  })

  it('rejects a chain ID mismatch', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(studionet, { chainId: '0x1' }),
      'studionet',
      studionet,
      referenceFor(),
    )).rejects.toMatchObject({ code: 'CHAIN_ID_MISMATCH' })
  })

  it('rejects a shared chain ID when the selected consensus contract is missing', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury, { code: '0x' }),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(),
    )).rejects.toMatchObject({
      code: 'CONSENSUS_CODE_MISSING',
      message: expect.stringContaining("Change the wallet's chain-4221 RPC"),
    })
  })

  it.each(['eth_getCode', 'eth_call'])('fails closed when provider %s lookup fails', async (failMethod) => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetAsimov, { failMethod }),
      'testnetAsimov',
      testnetAsimov,
      referenceFor(),
    )).rejects.toMatchObject({ code: 'RPC_FAILURE' })
  })

  it('rejects the wrong chain-4221 RPC even if the selected consensus address has code', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetAsimov, { block: otherBlockHash }),
      'testnetAsimov',
      testnetAsimov,
      referenceFor(blockHash),
    )).rejects.toMatchObject({
      code: 'AMBIGUOUS_SHARED_CHAIN',
      message: expect.stringContaining("Change the wallet's chain-4221 RPC"),
    })
  })

  it('rejects a stale chain-4221 provider instead of comparing a pre-divergence block', async () => {
    await expect(verifyInjectedWalletNetwork(
      providerFor(testnetBradbury),
      'testnetBradbury',
      testnetBradbury,
      referenceFor(blockHash, '0x21'),
    )).rejects.toMatchObject({
      code: 'AMBIGUOUS_SHARED_CHAIN',
      message: expect.stringContaining('does not exactly match'),
    })
  })
})

describe('runVerifiedWalletWrite', () => {
  it.each([
    ['payable', 1n],
    ['nonpayable', 0n],
  ] as const)('blocks a %s write before writeContract when identity is ambiguous', async (_label, value) => {
    const writeContract = vi.fn(async (_request: { value: bigint }) => '0xtransaction')
    await expect(runVerifiedWalletWrite({
      provider: providerFor(testnetBradbury, { block: otherBlockHash }),
      networkSelector: 'testnetBradbury',
      chain: testnetBradbury,
      referenceRequest: referenceFor(blockHash),
      write: () => writeContract({ value }),
    })).rejects.toMatchObject({ code: 'AMBIGUOUS_SHARED_CHAIN' })
    expect(writeContract).not.toHaveBeenCalled()
  })
})
