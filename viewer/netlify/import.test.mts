// Branch-coverage test for the transport import handler. Runs with `tsx` and an
// injected fake store — no live Netlify Blobs needed.
//   node_modules/.bin/tsx viewer/netlify/import.test.mts
import assert from 'node:assert/strict'
import { handleImport } from './functions/import.mts'

type Meta = { name: string; ts: number }

/** In-memory stand-in for a Netlify Blobs Store (only the methods we use). */
function memStore() {
  const data = new Map<string, string>()
  return {
    data,
    async set(id: string, body: string, _opts?: { metadata?: Meta }) {
      data.set(id, body)
    },
    async get(id: string, _opts?: { type: 'text' }) {
      return data.has(id) ? data.get(id)! : null
    },
  } as any
}

/** A store whose ops always throw — simulates Blobs being unavailable. */
function brokenStore() {
  return {
    async set() {
      throw new Error('MissingBlobsEnvironmentError: blobs not configured')
    },
    async get() {
      throw new Error('MissingBlobsEnvironmentError: blobs not configured')
    },
  } as any
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://openvisio.io/api/import', { method: 'POST', body, headers })
const get = (qs: string) => new Request(`https://openvisio.io/api/import${qs}`, { method: 'GET' })

let passed = 0
async function test(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const graph = JSON.stringify({ name: 'demo', files: [], symbols: [], edges: [] })

await test('POST valid graph → 201 with id + url, persisted', async () => {
  const store = memStore()
  const res = await handleImport(post(graph, { 'x-openvisio-name': 'demo' }), store)
  assert.equal(res.status, 201)
  const json = (await res.json()) as { id: string; url: string }
  assert.match(json.id, /^[0-9a-f]{10}$/)
  assert.equal(json.url, `https://openvisio.io/?g=${json.id}`)
  assert.equal(store.data.get(json.id), graph)
})

await test('POST oversized body → 413 (byte-accurate)', async () => {
  // 6 MB + 1 byte of ASCII.
  const huge = 'x'.repeat(6 * 1024 * 1024 + 1)
  const res = await handleImport(post(huge), memStore())
  assert.equal(res.status, 413)
})

await test('POST multibyte body just over the byte cap → 413 (length would miss it)', async () => {
  // 'é' is 1 UTF-16 code unit but 2 bytes. (3 Mi + 1) chars = ~6 MB + 2 bytes:
  // a naive string.length check (< 6Mi) would WRONGLY accept this.
  const MAX_LEN = 6 * 1024 * 1024
  const s = 'é'.repeat(3 * 1024 * 1024 + 1)
  assert.ok(s.length < MAX_LEN, 'precondition: length is under the old char limit')
  assert.ok(Buffer.byteLength(s) > 6 * 1024 * 1024, 'precondition: bytes exceed the cap')
  const res = await handleImport(post(s), memStore())
  assert.equal(res.status, 413)
})

await test('POST invalid JSON → 400', async () => {
  const res = await handleImport(post('not json {'), memStore())
  assert.equal(res.status, 400)
})

await test('POST when blob write throws → 502 with detail, not 500', async () => {
  const res = await handleImport(post(graph), brokenStore())
  assert.equal(res.status, 502)
  const json = (await res.json()) as { error: string }
  assert.match(json.error, /storage write failed/)
  assert.match(json.error, /MissingBlobsEnvironmentError/)
})

await test('GET round-trips a stored graph → 200 with original body', async () => {
  const store = memStore()
  const created = (await (await handleImport(post(graph), store)).json()) as { id: string }
  const res = await handleImport(get(`?id=${created.id}`), store)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.equal(await res.text(), graph)
})

await test('GET without id → 400', async () => {
  const res = await handleImport(get(''), memStore())
  assert.equal(res.status, 400)
})

await test('GET unknown id → 404', async () => {
  const res = await handleImport(get('?id=deadbeef00'), memStore())
  assert.equal(res.status, 404)
})

await test('GET when blob read throws → 502, not 500', async () => {
  const res = await handleImport(get('?id=whatever00'), brokenStore())
  assert.equal(res.status, 502)
})

await test('PUT → 405', async () => {
  const req = new Request('https://openvisio.io/api/import', { method: 'PUT' })
  const res = await handleImport(req, memStore())
  assert.equal(res.status, 405)
})

console.log(`\n${passed} passed`)
