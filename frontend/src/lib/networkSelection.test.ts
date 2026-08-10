import { describe, expect, it } from 'vitest'
import { studionet, testnetBradbury } from 'genlayer-js/chains'
import {
  DEFAULT_GENLAYER_NETWORK,
  SUPPORTED_GENLAYER_NETWORKS,
  selectGenLayerNetwork,
} from './networkSelection'

describe('selectGenLayerNetwork', () => {
  it('defaults an unset or blank selector to Bradbury', () => {
    expect(selectGenLayerNetwork()).toEqual({ name: DEFAULT_GENLAYER_NETWORK, chain: testnetBradbury })
    expect(selectGenLayerNetwork('  ')).toEqual({ name: DEFAULT_GENLAYER_NETWORK, chain: testnetBradbury })
  })

  it.each([
    ['studionet', studionet],
    ['testnetBradbury', testnetBradbury],
  ] as const)('returns the complete official %s chain object', (name, chain) => {
    const selected = selectGenLayerNetwork(name)
    expect(selected).toEqual({ name, chain })
    expect(selected.chain).toBe(SUPPORTED_GENLAYER_NETWORKS[name])
    expect(selected.chain.consensusMainContract.address).toBe(chain.consensusMainContract.address)
    expect(selected.chain.rpcUrls.default.http[0]).toBe(chain.rpcUrls.default.http[0])
  })

  it('rejects unsupported or differently-cased selectors', () => {
    expect(() => selectGenLayerNetwork('localnet')).toThrow('Unsupported GenLayer network')
    expect(() => selectGenLayerNetwork('Studionet')).toThrow('Unsupported GenLayer network')
    expect(() => selectGenLayerNetwork('testnetAsimov')).toThrow('Unsupported GenLayer network')
  })

  it('retains the official Bradbury execution configuration', () => {
    const bradbury = selectGenLayerNetwork('testnetBradbury').chain
    expect(bradbury.id).toBe(4221)
    expect(bradbury.rpcUrls.default.http[0]).toBe('https://rpc-bradbury.genlayer.com')
    expect(bradbury.consensusMainContract.address).toBe('0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D')
  })
})
