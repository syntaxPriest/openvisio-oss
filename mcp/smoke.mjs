// End-to-end smoke test for the OpenVisio MCP server. Spins up the built server
// over stdio against a disposable repo and exercises every phase: the 7 tools,
// the spotlight SSE stream, incremental --watch, and determinism. Run with:
//
//   npm run smoke        (builds first)   — or   node mcp/smoke.mjs
//
// Exits non-zero on any failure. No network; binds 127.0.0.1 only.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 7099

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) {
    pass++
    console.log('  ✓ ' + msg)
  } else {
    fail++
    console.log('  ✗ ' + msg)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Disposable repo so the --watch edit test never touches real files.
const root = path.join('/tmp', `ov_smoke_${process.pid}`)
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(path.join(root, 'src'), { recursive: true })
fs.writeFileSync(path.join(root, 'src/types.ts'), `export interface User { id: number }\nexport type Role = 'admin' | 'user'\n`)
fs.writeFileSync(path.join(root, 'src/auth.ts'), `import { User } from './types'\nexport function login(u: User){ return u.id }\n`)
fs.writeFileSync(path.join(root, 'src/api.ts'), `import { login } from './auth'\nimport { Role } from './types'\nexport function handler(){ return login }\n`)

const transport = new StdioClientTransport({
  command: 'node',
  args: ['mcp/dist/cli.js', 'mcp', root, '--watch', '--spotlight', `--port=${PORT}`],
  cwd: repoRoot,
  stderr: 'inherit',
})
const client = new Client({ name: 'smoke', version: '0' })
await client.connect(transport)
await sleep(400)
const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text

console.log('\n[tools] surface + output')
const tools = (await client.listTools()).tools.map((t) => t.name)
// 7 read-only tools + the reverse channel (get_user_request + submit_answer), present under --spotlight.
ok(tools.length === 9, `lists 9 tools: ${tools.join(', ')}`)
ok(tools.includes('get_user_request') && tools.includes('submit_answer'), 'reverse-channel tools registered under --spotlight')
ok((await call('resolve_context', { task_description: 'add admin role check to login' })).includes('auth.ts'), 'resolve_context surfaces auth.ts')
ok((await call('get_repo_skeleton', { budget_tokens: 400 })).includes('@src/'), 'get_repo_skeleton has path:line anchors')
ok((await call('find_symbol', { name: 'login' })).includes('src/auth.ts:'), 'find_symbol(login) returns an anchor')
ok((await call('get_dependents', { target: 'types.ts' })).includes('is imported by'), 'get_dependents(types.ts) lists importers')
ok((await call('get_neighborhood', { target: 'auth.ts' })).includes('CENTER'), 'get_neighborhood(auth.ts) has a CENTER')
ok((await call('get_hotspots', {})).includes('centrality'), 'get_hotspots ranks by centrality')
ok((await call('get_languages', {})).includes('loc'), 'get_languages lists languages with loc')

console.log('\n[spotlight] SSE stream')
const health = await new Promise((res, rej) =>
  http.get({ host: '127.0.0.1', port: PORT, path: '/health' }, (r) => {
    let b = ''
    r.on('data', (c) => (b += c))
    r.on('end', () => res(b))
  }).on('error', rej),
)
ok(JSON.parse(health)?.ok === true, 'GET /health -> {ok:true}')
const events = []
const sse = http.get({ host: '127.0.0.1', port: PORT, path: '/api/spotlight' }, (r) => {
  let buf = ''
  r.on('data', (c) => {
    buf += c
    let i
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const d = frame.split('\n').find((l) => l.startsWith('data:'))
      if (d) events.push(JSON.parse(d.slice(5).trim()))
    }
  })
})
await sleep(150)
await call('find_symbol', { name: 'handler' })
await sleep(200)
ok(events.length >= 1 && events[0].focus.includes('src/api.ts'), 'tool call broadcasts a path-keyed spotlight event')

console.log('\n[request bus] viewer → agent reverse channel')
// Raw HTTP helpers for the request routes.
const reqHttp = (method, p, body) =>
  new Promise((res, rej) => {
    const payload = body ? JSON.stringify(body) : null
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: payload ? { 'Content-Type': 'application/json' } : {} },
      (resp) => {
        let b = ''
        resp.on('data', (c) => (b += c))
        resp.on('end', () => res({ status: resp.statusCode, body: b }))
      },
    )
    r.on('error', rej)
    if (payload) r.write(payload)
    r.end()
  })

// A second SSE subscriber to observe queued/consumed acks.
const acks = []
const sse2 = http.get({ host: '127.0.0.1', port: PORT, path: '/api/spotlight' }, (r) => {
  let buf = ''
  r.on('data', (c) => {
    buf += c
    let i
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const d = frame.split('\n').find((l) => l.startsWith('data:'))
      if (d) acks.push(JSON.parse(d.slice(5).trim()))
    }
  })
})
await sleep(150)

const post = await reqHttp('POST', '/api/request', {
  instruction: 'what does login do?',
  paths: ['src/auth.ts'],
  kind: 'question',
})
const reqId = JSON.parse(post.body).id
ok(post.status === 201 && reqId, 'POST /api/request enqueues a question -> 201 {id}')
const badPost = await reqHttp('POST', '/api/request', { paths: ['x'] })
ok(badPost.status === 400, 'POST without instruction -> 400')
await sleep(100)
ok(acks.some((e) => e.kind === 'queued'), "enqueue broadcasts a 'queued' frame")

const pulled = await call('get_user_request', {})
ok(pulled.includes('what does login do?'), 'get_user_request returns the queued question')
ok(pulled.includes('@src/auth.ts'), 'get_user_request lists the selected file')
ok(pulled.includes('Staged context'), 'get_user_request stages resolve_context output')
ok(pulled.includes('QUESTION') && pulled.includes(reqId), 'get_user_request flags a question + its request_id')
await sleep(150)
ok(acks.some((e) => e.kind === 'consumed'), "draining via the tool broadcasts a 'consumed' ack")

// Return leg: the agent answers → viewer receives an 'answer' frame.
const answered = await call('submit_answer', { request_id: reqId, answer: 'login returns the user id.' })
ok(answered.includes('delivered'), 'submit_answer confirms delivery')
await sleep(150)
ok(
  acks.some((e) => e.kind === 'answer' && e.requestId === reqId && e.answer.includes('user id')),
  "submit_answer broadcasts an 'answer' frame the viewer can correlate",
)
ok((await call('get_user_request', {})).includes('No pending'), 'queue is empty after the pull (exactly-once)')
sse2.destroy()
sse.destroy()

console.log('\n[watch] incremental re-index')
ok((await call('find_symbol', { name: 'logout' })).includes('No symbols'), 'logout absent before edit')
fs.writeFileSync(path.join(root, 'src/auth.ts'), `import { User } from './types'\nexport function login(u: User){ return u.id }\nexport function logout(){ return true }\n`)
await sleep(900)
ok((await call('find_symbol', { name: 'logout' })).includes('src/auth.ts:'), 'logout found after disk edit (no restart)')

console.log('\n[determinism]')
const s1 = await call('get_repo_skeleton', { budget_tokens: 500 })
const s2 = await call('get_repo_skeleton', { budget_tokens: 500 })
ok(s1 === s2, 'get_repo_skeleton byte-identical across calls')

await client.close()
fs.rmSync(root, { recursive: true, force: true })
console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
