import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import worker, { MutableEvidenceState } from '../../hosting/live-evidence/worker.mjs'

const fixtureRoot = join(process.cwd(), 'tests/fixtures/live')
const rejectionPath = join(fixtureRoot, 'adversarial_rejection_v1.txt')

function fixture(name) {
  return readFileSync(join(fixtureRoot, name))
}

function assetsBinding() {
  return {
    async fetch(request) {
      const name = new URL(request.url).pathname.slice(1)
      if (!['approval_v1.txt', 'adversarial_rejection_v1.txt', 'mutable_initial_v1.txt', 'mutable_changed_v1.txt'].includes(name)) {
        return new Response('not found', { status: 404 })
      }
      return new Response(fixture(name), { headers: { 'content-type': 'text/plain' } })
    },
  }
}

function environment() {
  const values = new Map()
  const storage = {
    async get(key) { return values.get(key) },
    async put(key, value) { values.set(key, value) },
  }
  const durableObject = {
    async fetch(request) {
      return new MutableEvidenceState({ storage }).fetch(request)
    },
  }
  return {
    ASSETS: assetsBinding(),
    MUTATION_TOKEN: 'local-test-token',
    MUTABLE_EVIDENCE: {
      idFromName(name) { return name },
      get() { return durableObject },
    },
  }
}

test('approval route serves stable raw text with both rubric facts', async () => {
  const response = await worker.fetch(
    new Request('https://evidence.example/approve.txt'),
    environment(),
  )
  assert.equal(response.status, 200)
  assert.equal(Buffer.from(await response.arrayBuffer()).compare(fixture('approval_v1.txt')), 0)
  const text = await (async () => {
    const fresh = await worker.fetch(new Request('https://evidence.example/approve.txt'), environment())
    return fresh.text()
  })()
  assert.match(text, /CONTENT BOUNTY LIVE PASS/)
  assert.match(text, /https:\/\/docs\.genlayer\.com\//)
})

test('rejection route serves the exact committed fixture bytes and digest', async () => {
  const response = await worker.fetch(
    new Request('https://evidence.example/reject.txt'),
    environment(),
  )
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(bytes.compare(fixture('adversarial_rejection_v1.txt')), 0)
  const normalized = bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  assert.equal(createHash('sha256').update(normalized, 'utf8').digest('hex'), 'efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537')
  assert.equal(normalized.length, 1092)
})

test('mutation webhook persists changed state and changes mutable bytes', async () => {
  const env = environment()
  const mutableUrl = 'https://evidence.example/mutable.txt'
  const before = await worker.fetch(new Request(mutableUrl), env)
  assert.equal(Buffer.from(await before.arrayBuffer()).compare(fixture('mutable_initial_v1.txt')), 0)

  const unauthorized = await worker.fetch(
    new Request('https://evidence.example/mutate?token=wrong', {
      method: 'POST',
      body: JSON.stringify({ uri: mutableUrl }),
      headers: { 'content-type': 'application/json' },
    }),
    env,
  )
  assert.equal(unauthorized.status, 401)

  const mutated = await worker.fetch(
    new Request('https://evidence.example/mutate?token=local-test-token', {
      method: 'POST',
      body: JSON.stringify({ uri: mutableUrl }),
      headers: { 'content-type': 'application/json' },
    }),
    env,
  )
  assert.equal(mutated.status, 200)

  const after = await worker.fetch(new Request(mutableUrl), env)
  assert.equal(Buffer.from(await after.arrayBuffer()).compare(fixture('mutable_changed_v1.txt')), 0)
  const health = await worker.fetch(new Request('https://evidence.example/healthz'), env)
  assert.equal((await health.json()).mutableState, 'mutated')
})
