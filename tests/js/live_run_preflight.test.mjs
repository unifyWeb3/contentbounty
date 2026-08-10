import assert from 'node:assert/strict'
import test from 'node:test'
import { preflightLiveRun } from '../../scripts/live-run-preflight.mjs'
import { loadCommittedLiveAdversarialFixture } from '../../scripts/live-adversarial-fixture.mjs'
import { readFileSync } from 'node:fs'

const fixture = loadCommittedLiveAdversarialFixture()
const rejection = readFileSync('tests/fixtures/live/adversarial_rejection_v1.txt', 'utf8')
const approval = 'CONTENT BOUNTY LIVE PASS\nhttps://docs.genlayer.com/\n'
const mutable = 'initial mutable evidence'
const deployer = { address: '0x381b78F0C90a29cE2acDB718a9A4E1387004D3c7' }
const creator = { address: '0x7fD87C28F4345ee8A4124511e16084464ca2E123' }

function response(body, contentType = 'text/plain', status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

function options(overrides = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const path = new URL(url).pathname
    if (path === '/approve.txt') return response(approval)
    if (path === '/reject.txt') return response(rejection)
    if (path === '/mutable.txt') return response(mutable)
    if (path === '/healthz') return response('{"mutableState":"initial"}', 'application/json')
    throw new Error(`unexpected ${path}`)
  }
  return {
    calls,
    input: {
      network: 'testnetBradbury', proofMode: 'persistent', deployer, creator,
      deployerClient: { getBalance: async () => 100_000_000_000_000_000n },
      creatorClient: { getBalance: async () => 100_000_000_000_000_000n },
      reward: 1_000_000_000_000_000n,
      approvalUri: 'https://evidence.example/approve.txt',
      rejectionUri: 'https://evidence.example/reject.txt',
      mutableUri: 'https://evidence.example/mutable.txt',
      mutationWebhookUrl: 'https://evidence.example/mutate?token=secret',
      adversarialFixture: fixture,
      fetchImpl,
      ...overrides,
    },
  }
}

test('passes funded Bradbury recovery preflight without calling the mutation webhook', async () => {
  const { input, calls } = options()
  const result = await preflightLiveRun(input)
  assert.equal(result.mutationWebhookCalled, false)
  assert.equal(result.rejection.normalizedSha256, fixture.expectedNormalizedSha256)
  assert.equal(result.rejection.characterCount, 1092)
  assert.equal(calls.length, 4)
  assert.equal(calls.some((call) => call.url.includes('/mutate')), false)
  assert.equal(calls.every((call) => call.init === undefined), true)
})

test('reconciles PENDING plus mutated without reporting mutable evidence as initial', async () => {
  const { input } = options({
    mutationCheckpoint: {
      state: 'PENDING',
      mutableEvidenceUri: 'https://evidence.example/mutable.txt',
      pendingAt: '2026-08-09T00:00:00Z',
    },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname
      if (path === '/healthz') return response('{"mutableState":"mutated"}', 'application/json')
      if (path === '/approve.txt') return response(approval)
      if (path === '/reject.txt') return response(rejection)
      return response(mutable)
    },
  })
  const result = await preflightLiveRun(input)
  assert.equal(result.mutationState.state, 'CONFIRMED')
  assert.equal(result.mutationWebhookCalled, true)
  assert.equal(result.mutableEvidenceInitial, false)
})

test('reconciles CONFIRMED plus mutated without reporting mutable evidence as initial', async () => {
  const { input } = options({
    mutationCheckpoint: {
      state: 'CONFIRMED',
      mutableEvidenceUri: 'https://evidence.example/mutable.txt',
    },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname
      if (path === '/healthz') return response('{"mutableState":"mutated"}', 'application/json')
      if (path === '/approve.txt') return response(approval)
      if (path === '/reject.txt') return response(rejection)
      return response(mutable)
    },
  })
  const result = await preflightLiveRun(input)
  assert.equal(result.mutationState.state, 'CONFIRMED')
  assert.equal(result.mutationWebhookCalled, true)
  assert.equal(result.mutableEvidenceInitial, false)
})

test('fails closed for CONFIRMED plus initial and NOT_STARTED plus mutated', async () => {
  await assert.rejects(preflightLiveRun(options({
    mutationCheckpoint: { state: 'CONFIRMED', mutableEvidenceUri: 'https://evidence.example/mutable.txt' },
  }).input), /still reports initial/)
  await assert.rejects(preflightLiveRun(options({
    fetchImpl: async (url) => {
      const path = new URL(url).pathname
      if (path === '/healthz') return response('{"mutableState":"mutated"}', 'application/json')
      if (path === '/approve.txt') return response(approval)
      if (path === '/reject.txt') return response(rejection)
      return response(mutable)
    },
  }).input), /not initial|legitimate mutation checkpoint/)
})

test('rejects the exposed deployer before balances, endpoints, or writes', async () => {
  let balanceCalls = 0
  const { input, calls } = options({
    deployer: { address: '0x3d5915888E60CdaFFbB1F94DeeB71694F5de2a5d' },
    deployerClient: { getBalance: async () => { balanceCalls += 1; return 1n } },
  })
  await assert.rejects(preflightLiveRun(input), /compromised account/)
  assert.equal(balanceCalls, 0)
  assert.equal(calls.length, 0)
})

test('rejects the earlier compromised deployer before any balance lookup', async () => {
  let balanceCalls = 0
  const { input, calls } = options({
    deployer: { address: '0x3211d1419709682b81c53CC51cb63622E25488d3' },
    deployerClient: { getBalance: async () => { balanceCalls += 1; return 1n } },
  })
  await assert.rejects(preflightLiveRun(input), /compromised account/)
  assert.equal(balanceCalls, 0)
  assert.equal(calls.length, 0)
})

test('rejects either compromised address in the creator signing path before balances', async () => {
  for (const address of [
    '0x3211d1419709682b81c53CC51cb63622E25488d3',
    '0x3d5915888E60CdaFFbB1F94DeeB71694F5de2a5d',
  ]) {
    let balanceCalls = 0
    const { input, calls } = options({
      creator: { address },
      creatorClient: { getBalance: async () => { balanceCalls += 1; return 1n } },
    })
    await assert.rejects(preflightLiveRun(input), /compromised account/)
    assert.equal(balanceCalls, 0)
    assert.equal(calls.length, 0)
  }
})

test('fails closed for underfunding, changed mutable state, or rejection mismatch', async () => {
  await assert.rejects(preflightLiveRun(options({ deployerClient: { getBalance: async () => 1n } }).input), /underfunded/)
  const changed = options({ fetchImpl: async (url) => new URL(url).pathname === '/healthz'
    ? response('{"mutableState":"changed"}', 'application/json')
    : response(new URL(url).pathname === '/reject.txt' ? rejection : mutable) })
  await assert.rejects(preflightLiveRun(changed.input), /not initial/)
  const mismatch = options({ fetchImpl: async (url) => {
    const path = new URL(url).pathname
    if (path === '/healthz') return response('{"mutableState":"initial"}', 'application/json')
    if (path === '/approve.txt') return response(approval)
    return response(path === '/reject.txt' ? 'wrong' : mutable)
  } })
  await assert.rejects(preflightLiveRun(mismatch.input), /SHA-256 mismatch/)
})

test('retries transient balance and GET failures without ever posting to mutation', async () => {
  let balanceCalls = 0
  let fetchCalls = 0
  const { input, calls } = options({
    deployerClient: {
      getBalance: async () => {
        balanceCalls += 1
        if (balanceCalls === 1) throw new Error('fetch failed')
        return 100_000_000_000_000_000n
      },
    },
  })
  const originalFetch = input.fetchImpl
  input.fetchImpl = async (...args) => {
    fetchCalls += 1
    if (fetchCalls === 1) throw new Error('fetch failed')
    return originalFetch(...args)
  }
  input.transientRetries = 1
  input.transientRetryInterval = 0
  input.sleep = async () => {}
  const result = await preflightLiveRun(input)
  assert.equal(balanceCalls, 2)
  assert.equal(result.mutationWebhookCalled, false)
  assert.equal(calls.some((call) => call.init?.method === 'POST'), false)
})
