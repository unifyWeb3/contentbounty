import { describe, expect, it } from 'vitest'
import { studionet, testnetAsimov, testnetBradbury } from 'genlayer-js/chains'
import {
  DEFAULT_GENLAYER_NETWORK,
  SUPPORTED_GENLAYER_NETWORKS,
  selectGenLayerNetwork,
} from './networkSelection'

describe('selectGenLayerNetwork', () => {
  it('defaults an unset or blank selector to Studionet', () => {
    expect(selectGenLayerNetwork()).toEqual({ name: DEFAULT_GENLAYER_NETWORK, chain: studionet })
    expect(selectGenLayerNetwork('  ')).toEqual({ name: DEFAULT_GENLAYER_NETWORK, chain: studionet })
  })

  it.each([
    ['studionet', studionet],
    ['testnetAsimov', testnetAsimov],
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
  })

  it('does not collapse Asimov and Bradbury just because their chain IDs match', () => {
    const asimov = selectGenLayerNetwork('testnetAsimov').chain
    const bradbury = selectGenLayerNetwork('testnetBradbury').chain
    expect(asimov.id).toBe(bradbury.id)
    expect(asimov.rpcUrls.default.http[0]).not.toBe(bradbury.rpcUrls.default.http[0])
    expect(asimov.consensusMainContract.address).not.toBe(bradbury.consensusMainContract.address)
  })
})
