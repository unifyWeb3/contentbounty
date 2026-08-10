const DURABLE_OBJECT_NAME = 'contentbounty-live-mutable-v1'
const REJECTION_ASSET = '/adversarial_rejection_v1.txt'
const APPROVAL_ASSET = '/approval_v1.txt'
const MUTABLE_INITIAL_ASSET = '/mutable_initial_v1.txt'
const MUTABLE_CHANGED_ASSET = '/mutable_changed_v1.txt'

const RAW_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'x-contentbounty-evidence-format': 'content-bounty-text-v1',
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function raw(body, cacheControl = 'no-store') {
  return new Response(body, {
    headers: { ...RAW_HEADERS, 'cache-control': cacheControl },
  })
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let difference = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

async function asset(env, request, pathname, cacheControl) {
  const assetUrl = new URL(request.url)
  assetUrl.pathname = pathname
  assetUrl.search = ''
  const response = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }))
  if (!response.ok) return json({ error: `Missing evidence asset ${pathname}` }, 500)
  return raw(await response.arrayBuffer(), cacheControl)
}

function mutableStub(env) {
  const id = env.MUTABLE_EVIDENCE.idFromName(DURABLE_OBJECT_NAME)
  return env.MUTABLE_EVIDENCE.get(id)
}

async function mutableState(env) {
  const response = await mutableStub(env).fetch(
    new Request('https://contentbounty.internal/state'),
  )
  if (!response.ok) throw new Error('Mutable evidence state lookup failed')
  return response.json()
}

export class MutableEvidenceState {
  constructor(ctx) {
    this.storage = ctx.storage
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/state') {
      const state = await this.storage.get('state')
      return json({
        mutated: state?.mutated === true,
        mutatedAt: state?.mutatedAt ?? null,
      })
    }
    if (request.method === 'POST' && url.pathname === '/mutate') {
      const state = { mutated: true, mutatedAt: new Date().toISOString() }
      await this.storage.put('state', state)
      return json({ ok: true, ...state })
    }
    return json({ error: 'Not found' }, 404)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/healthz') {
      const state = await mutableState(env)
      return json({
        ok: true,
        fixtureVersion: 'content-bounty-live-adversarial-rejection-v1',
        rejectionPath: REJECTION_ASSET,
        rejectionNormalizedSha256: 'efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537',
        rejectionCharacterCount: 1092,
        mutableState: state.mutated ? 'mutated' : 'initial',
      })
    }
    if (request.method === 'GET' && url.pathname === '/approve.txt') {
      return asset(env, request, APPROVAL_ASSET, 'public, max-age=300, immutable')
    }
    if (request.method === 'GET' && url.pathname === '/reject.txt') {
      return asset(env, request, REJECTION_ASSET, 'public, max-age=300, immutable')
    }
    if (request.method === 'GET' && url.pathname === '/mutable.txt') {
      const state = await mutableState(env)
      return asset(
        env,
        request,
        state.mutated ? MUTABLE_CHANGED_ASSET : MUTABLE_INITIAL_ASSET,
        'no-store',
      )
    }
    if (request.method === 'POST' && url.pathname === '/mutate') {
      const expectedToken = typeof env.MUTATION_TOKEN === 'string' ? env.MUTATION_TOKEN : ''
      const providedToken = url.searchParams.get('token') ?? ''
      if (!expectedToken || !constantTimeEqual(providedToken, expectedToken)) {
        return json({ error: 'Unauthorized' }, 401)
      }
      let body
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Request body must be JSON' }, 400)
      }
      const expectedUri = new URL('/mutable.txt', request.url).href
      if (!body || body.uri !== expectedUri) {
        return json({ error: `uri must equal ${expectedUri}` }, 400)
      }
      return mutableStub(env).fetch(
        new Request('https://contentbounty.internal/mutate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
    }
    return json({ error: 'Not found' }, 404)
  },
}
