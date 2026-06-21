// Live "agent spotlight" channel. When the agent calls a tool, the MCP server
// broadcasts a highlight event over SSE so any open OpenVisio viewer can pulse
// the buildings (City view) and emphasize the edges (graph view) the agent is
// looking at. Purely additive: the MCP server works fine with no viewer
// attached, and the viewer works fine with no stream.
//
// Cross-process key is the FILE PATH, not a numeric id — the standalone MCP
// graph and the viewer's graph are built independently, but both key files by
// repo-relative path, so paths are the stable shared identity. Local-first: the
// server binds to 127.0.0.1 only (no network exposure).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'

/**
 * A frame broadcast to viewers over the one SSE channel. `kind` discriminates:
 *   'highlight' (default) — the agent is looking at `focus`/`edges`.
 *   'queued'    — the viewer's instruction was enqueued (echoes the request id).
 *   'consumed'  — an agent drained that instruction (the viewer's delivery ack).
 * Older viewers ignore unknown kinds (they branch on `v === 1` only), so the
 * extra kinds are additive and backward-compatible. Paths are repo-relative POSIX.
 */
export interface SpotlightEvent {
  /** Schema version, for forward-compatible viewers. */
  v: 1
  /** Frame type (default 'highlight' so existing emitters need no change). */
  kind?: 'highlight' | 'queued' | 'consumed' | 'answer'
  /** Which tool produced this (shown in the viewer toast). */
  tool: string
  /** Primary files to highlight (the agent's focus). */
  focus: string[]
  /** Import edges to emphasize, as [fromPath, toPath] pairs. */
  edges: [string, string][]
  /** Hint to dim everything not in focus. */
  dim: boolean
  /** For 'queued'/'consumed'/'answer' frames: the correlating request id. */
  requestId?: string
  /** For 'answer' frames: the coding agent's reply to a viewer question. */
  answer?: string
  /** For 'answer' frames: true on the final frame; partial frames stream the
   *  reply as it builds. Absent/true ⇒ treat as complete. */
  done?: boolean
  /** Emit time (ms). Set by the bus, not the caller (keeps callers deterministic). */
  ts: number
}

/**
 * A user instruction composed in the viewer, queued for a running coding agent
 * to pull (via the get_user_request tool) or intercept (via the UserPromptSubmit
 * hook). Paths are repo-relative POSIX — the same cross-process identity the
 * spotlight uses. This is the reverse of the highlight channel: viewer → agent.
 */
export interface UserRequest {
  /** Schema version. */
  v: 1
  /** Stable id — used for the consumed-ack and to correlate the answer. */
  id: string
  /**
   * 'question' expects the agent to reply via submit_answer (round-trips to the
   * viewer); 'instruction' is fire-and-forget work. Defaults to 'instruction'.
   */
  kind: 'question' | 'instruction'
  /** The user's typed question or instruction. */
  instruction: string
  /** Selected files to ground the request in. */
  paths: string[]
  /** Optional token budget hint for the agent's context staging. */
  budgetTokens?: number
  /** Enqueue time (ms). Stamped by the queue, not the caller. */
  ts: number
}

const CORS_HEADERS = {
  // The viewer runs on a different localhost port (e.g. :3000); allow it to read
  // this local stream and POST instructions back. No credentials, local-only.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/**
 * Holds connected SSE clients and broadcasts highlight events. Decoupled from
 * the HTTP server so tool handlers depend only on `emit`, not on transport.
 */
export class SpotlightBus {
  private clients = new Set<ServerResponse>()
  /** Last event, replayed to clients that connect mid-session. */
  private last: SpotlightEvent | null = null

  get clientCount(): number {
    return this.clients.size
  }

  add(res: ServerResponse): void {
    this.clients.add(res)
    if (this.last) this.write(res, this.last)
  }

  remove(res: ServerResponse): void {
    this.clients.delete(res)
  }

  /** Broadcast a highlight. `ts` is stamped here so callers stay side-effect-free. */
  emit(event: Omit<SpotlightEvent, 'ts'>, now: number): void {
    const full: SpotlightEvent = { ...event, ts: now }
    this.last = full
    for (const res of this.clients) this.write(res, full)
  }

  private write(res: ServerResponse, event: SpotlightEvent): void {
    try {
      res.write(`event: spotlight\ndata: ${JSON.stringify(event)}\n\n`)
    } catch {
      this.clients.delete(res)
    }
  }

  ping(): void {
    for (const res of this.clients) {
      try {
        res.write(': ping\n\n')
      } catch {
        this.clients.delete(res)
      }
    }
  }

  closeAll(): void {
    for (const res of this.clients) {
      try {
        res.end()
      } catch {
        // already gone
      }
    }
    this.clients.clear()
  }
}

/** How long a queued instruction stays pullable before it's considered stale. */
const REQUEST_TTL_MS = 10 * 60 * 1000
/** Cap the queue so an agent that never pulls can't grow it unbounded. */
const REQUEST_CAP = 20

/**
 * The reverse channel: holds viewer-composed instructions until a coding agent
 * pulls one. FIFO, destructive read (exactly-once delivery), bounded length and
 * age. Decoupled from transport like SpotlightBus — the http handler enqueues,
 * the MCP tool / hook drains.
 */
export class RequestQueue {
  private items: UserRequest[] = []

  /** Drop entries older than the TTL. Called on every read so stale never leaks. */
  private prune(now: number): void {
    this.items = this.items.filter((r) => now - r.ts <= REQUEST_TTL_MS)
  }

  /** Stamp id + ts, append, and evict the oldest if over the cap. */
  enqueue(
    req: { instruction: string; paths: string[]; budgetTokens?: number; kind?: 'question' | 'instruction' },
    now: number,
  ): UserRequest {
    const full: UserRequest = {
      v: 1,
      id: randomUUID(),
      kind: req.kind === 'question' ? 'question' : 'instruction',
      instruction: req.instruction,
      paths: req.paths,
      budgetTokens: req.budgetTokens,
      ts: now,
    }
    this.prune(now)
    this.items.push(full)
    if (this.items.length > REQUEST_CAP) this.items.shift()
    return full
  }

  /** FIFO destructive pop — the next pending request, or null. */
  take(now: number): UserRequest | null {
    this.prune(now)
    return this.items.shift() ?? null
  }

  /**
   * FIFO destructive pop of the next QUESTION, leaving instructions in place
   * (those are for a human's interactive session). Powers the auto-answerer.
   */
  takeNextQuestion(now: number): UserRequest | null {
    this.prune(now)
    const i = this.items.findIndex((r) => r.kind === 'question')
    if (i === -1) return null
    const [req] = this.items.splice(i, 1)
    return req ?? null
  }

  /** Non-destructive peek at the next pending request, or null. */
  peek(now: number): UserRequest | null {
    this.prune(now)
    return this.items[0] ?? null
  }

  size(now: number): number {
    this.prune(now)
    return this.items.length
  }
}

export interface SpotlightServer {
  bus: SpotlightBus
  queue: RequestQueue
  port: number
  close: () => void
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/**
 * Serve a file from the mounted viewer dir. `/` maps to index.html. Path
 * traversal out of `dir` is refused. Local-only static assets — no caching so
 * an edited UI shows up on reload during development.
 */
function serveStatic(url: string, res: ServerResponse, dir: string): void {
  const rel = decodeURIComponent((url.split('?')[0] ?? '/'))
  const safe = nodePath.normalize(rel === '/' ? '/index.html' : rel).replace(/^(\.\.[/\\])+/, '')
  const filePath = nodePath.join(dir, safe)
  if (!filePath.startsWith(nodePath.resolve(dir))) {
    res.writeHead(403, CORS_HEADERS)
    res.end('forbidden')
    return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, CORS_HEADERS)
      res.end('not found')
      return
    }
    const type = STATIC_CONTENT_TYPES[nodePath.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache' })
    res.end(data)
  })
}

/** Read a request body as JSON, rejecting bodies over `limit` bytes. */
function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Start the spotlight HTTP server on 127.0.0.1:`port`. Serves:
 *   GET  /api/spotlight     → SSE stream of highlight + queued/consumed events
 *   POST /api/request       → enqueue a viewer instruction → 201 {id}
 *   GET  /api/request        → peek the next pending instruction (non-destructive)
 *   GET  /api/request?consume=1 → take the next pending instruction (destructive)
 *   GET  /health            → 200 {ok:true, pid} (pid identifies this process)
 * Resolves once listening. Heartbeats every 25s to keep proxies/streams alive.
 */
/**
 * Which kind of process owns the spotlight port. `agent` = the viewer-launched
 * hands-free answerer; `mcp` = a Claude Code / Codex MCP session. The viewer's
 * "start agent" route uses this to avoid killing a live MCP session.
 */
export type SpotlightMode = 'agent' | 'mcp'

/**
 * Builds the viewer's GraphResponse JSON for a repo path. Injected by the CLI
 * (which owns @openvisio/core) so this transport module stays core-free. When
 * provided, the spotlight server exposes an on-demand index endpoint.
 */
export type IndexFn = (repoPath: string) => Promise<unknown>

export function startSpotlightServer(
  port: number,
  mode: SpotlightMode = 'mcp',
  onIndex?: IndexFn,
  staticDir?: string,
): Promise<SpotlightServer> {
  const bus = new SpotlightBus()
  const queue = new RequestQueue()

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }
    const url = req.url ?? '/'
    if (url.startsWith('/api/graph') || url.startsWith('/api/index')) {
      handleIndexRoute(req, res, url, onIndex)
      return
    }
    if (url.startsWith('/api/emit')) {
      handleEmitRoute(req, res, bus)
      return
    }
    if (url.startsWith('/api/fs/browse')) {
      handleFsBrowseRoute(req, res, url)
      return
    }
    if (url.startsWith('/api/spotlight')) {
      res.writeHead(200, {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      res.write(': connected to openvisio spotlight\n\n')
      bus.add(res)
      req.on('close', () => bus.remove(res))
      return
    }
    if (url.startsWith('/api/request')) {
      handleRequestRoute(req, res, url, bus, queue)
      return
    }
    if (url.startsWith('/health')) {
      // Report this process's pid so a caller that just spawned the agent can
      // confirm it's talking to the NEW process, not a stale listener that
      // survived on the port. Body is JSON; existing probes only check res.ok.
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, pid: process.pid, mode }))
      return
    }
    // Anything else: serve the bundled viewer UI when a static dir is mounted
    // (the `openvisio view` command). Otherwise this is a headless API server.
    if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
      serveStatic(url, res, staticDir)
      return
    }
    res.writeHead(404, CORS_HEADERS)
    res.end('not found')
  }

  const server: Server = createServer(handler)
  const heartbeat = setInterval(() => bus.ping(), 25_000)
  heartbeat.unref() // don't keep the process alive just for pings

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        bus,
        queue,
        port,
        close: () => {
          clearInterval(heartbeat)
          bus.closeAll()
          server.close()
        },
      })
    })
  })
}

/** Max accepted POST body for an enqueued instruction. */
const MAX_REQUEST_BODY = 64 * 1024

/**
 * Handle the viewer↔agent request routes:
 *   POST /api/request            → enqueue {instruction, paths[]} → 201 {id}
 *   GET  /api/request            → peek the next pending request (non-destructive)
 *   GET  /api/request?consume=1  → take the next pending request (destructive)
 * Enqueue broadcasts a 'queued' frame; a destructive take broadcasts 'consumed'
 * (the viewer's delivery ack). Local-only — the server binds 127.0.0.1.
 */
function handleRequestRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  bus: SpotlightBus,
  queue: RequestQueue,
): void {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (req.method === 'POST') {
    readJsonBody(req, MAX_REQUEST_BODY)
      .then((body) => {
        const b = body as { instruction?: unknown; paths?: unknown; budgetTokens?: unknown; kind?: unknown }
        const instruction = typeof b.instruction === 'string' ? b.instruction.trim() : ''
        const paths = Array.isArray(b.paths) ? b.paths.filter((p): p is string => typeof p === 'string') : []
        if (!instruction) {
          json(400, { error: 'missing instruction' })
          return
        }
        const budgetTokens = typeof b.budgetTokens === 'number' ? b.budgetTokens : undefined
        const kind = b.kind === 'question' ? 'question' : 'instruction'
        const now = Date.now()
        const entry = queue.enqueue({ instruction, paths, budgetTokens, kind }, now)
        bus.emit({ v: 1, kind: 'queued', tool: 'viewer', focus: [], edges: [], dim: false, requestId: entry.id }, now)
        json(201, { id: entry.id, position: queue.size(now) })
      })
      .catch((err) => json(400, { error: err instanceof Error ? err.message : 'bad request' }))
    return
  }

  if (req.method === 'GET') {
    const now = Date.now()
    const consume = /[?&]consume=1\b/.test(url)
    const entry = consume ? queue.take(now) : queue.peek(now)
    if (entry && consume) {
      bus.emit({ v: 1, kind: 'consumed', tool: 'agent', focus: [], edges: [], dim: false, requestId: entry.id }, now)
    }
    json(200, entry ?? null)
    return
  }

  res.writeHead(405, CORS_HEADERS)
  res.end('method not allowed')
}

/**
 * Emit-ingress route — lets another LOCAL openvisio process (an MCP session that
 * couldn't bind the port) push a highlight/answer/consumed frame into this
 * server's bus so it reaches the viewer. This is what makes the spotlight a
 * shared singleton: one server owns 127.0.0.1:port, every agent feeds it.
 *   POST /api/emit  {SpotlightEvent}  → 204
 */
function handleEmitRoute(req: IncomingMessage, res: ServerResponse, bus: SpotlightBus): void {
  if (req.method !== 'POST') {
    res.writeHead(405, CORS_HEADERS)
    res.end('method not allowed')
    return
  }
  readJsonBody(req, MAX_REQUEST_BODY)
    .then((body) => {
      const e = body as Partial<SpotlightEvent>
      bus.emit(
        {
          v: 1,
          kind: e.kind ?? 'highlight',
          tool: typeof e.tool === 'string' ? e.tool : 'agent',
          focus: Array.isArray(e.focus) ? e.focus : [],
          edges: Array.isArray(e.edges) ? e.edges : [],
          dim: Boolean(e.dim),
          requestId: e.requestId,
          answer: e.answer,
          done: e.done,
        },
        Date.now(),
      )
      res.writeHead(204, CORS_HEADERS)
      res.end()
    })
    .catch((err) => {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'bad request' }))
    })
}

/**
 * On-demand index route — lets a viewer (or any local client) ask the running
 * server to build a repo's graph:
 *   GET  /api/graph?path=<repo>   → 200 GraphResponse JSON
 *   POST /api/index  {path}       → 200 GraphResponse JSON
 * Returns 501 when no indexer was injected, 400 on a missing path, 500 if the
 * build throws. Local-only — the server binds 127.0.0.1.
 */
function handleIndexRoute(req: IncomingMessage, res: ServerResponse, url: string, onIndex?: IndexFn): void {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (!onIndex) {
    json(501, { error: 'indexing not enabled on this server' })
    return
  }

  const run = (repoPath: string) => {
    if (!repoPath) {
      json(400, { error: 'missing repo path (?path= or {"path"})' })
      return
    }
    onIndex(repoPath)
      .then((payload) => json(200, payload))
      .catch((err) => json(500, { error: err instanceof Error ? err.message : String(err) }))
  }

  if (req.method === 'GET') {
    const q = url.indexOf('?')
    const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1))
    run((params.get('path') ?? '').trim())
    return
  }
  if (req.method === 'POST') {
    readJsonBody(req, MAX_REQUEST_BODY)
      .then((body) => run(typeof (body as { path?: unknown }).path === 'string' ? ((body as { path: string }).path).trim() : ''))
      .catch((err) => json(400, { error: err instanceof Error ? err.message : 'bad request' }))
    return
  }
  res.writeHead(405, CORS_HEADERS)
  res.end('method not allowed')
}

interface FsDirEntry {
  name: string
  path: string
  isGitRepo: boolean
  isHidden: boolean
}

/** Resolve raw user input to an absolute dir, expanding `~` and rooting relative
 *  paths at $HOME (the server cwd is an implementation detail the user can't see). */
function resolveBrowseInput(raw: string | null): string {
  const home = os.homedir()
  if (!raw || raw.trim().length === 0) return home
  let p = raw.trim()
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) p = nodePath.join(home, p.slice(2))
  if (!nodePath.isAbsolute(p)) p = nodePath.join(home, p)
  return nodePath.resolve(p)
}

/**
 * Local filesystem directory browser — powers the "browse" folder picker in the
 * viewer's indexing dialog. Lists subdirectories only (never file contents),
 * flags which folders look like git repos, and resolves `~`/relative input
 * against $HOME. Read-only and local-only, consistent with the indexer's trust
 * boundary (the server already reads local repos to index them).
 *   GET /api/fs/browse?path=<dir>  → 200 { path, parent, home, separator, entries[] }
 */
function handleFsBrowseRoute(req: IncomingMessage, res: ServerResponse, url: string): void {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'GET') {
    res.writeHead(405, CORS_HEADERS)
    res.end('method not allowed')
    return
  }

  const q = url.indexOf('?')
  const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1))
  const target = resolveBrowseInput(params.get('path'))

  void (async () => {
    try {
      const stat = await fs.promises.stat(target)
      if (!stat.isDirectory()) {
        json(400, { error: `Not a directory: ${target}` })
        return
      }
    } catch {
      json(404, { error: `Cannot access: ${target}` })
      return
    }

    let dirents
    try {
      dirents = await fs.promises.readdir(target, { withFileTypes: true })
    } catch {
      json(403, { error: `Permission denied: ${target}` })
      return
    }

    const entries: FsDirEntry[] = []
    for (const d of dirents) {
      // Symlinks report isDirectory() === false; resolve them so symlinked
      // repos still appear as navigable folders.
      let isDir = d.isDirectory()
      if (d.isSymbolicLink()) {
        try {
          isDir = (await fs.promises.stat(nodePath.join(target, d.name))).isDirectory()
        } catch {
          isDir = false
        }
      }
      if (!isDir) continue

      const full = nodePath.join(target, d.name)
      let isGitRepo = false
      try {
        isGitRepo = (await fs.promises.stat(nodePath.join(full, '.git'))).isDirectory()
      } catch {
        // not a git repo (or .git is a file/worktree pointer we don't probe)
      }
      entries.push({ name: d.name, path: full, isGitRepo, isHidden: d.name.startsWith('.') })
    }

    // Git repos first, then alphabetical, case-insensitive.
    entries.sort((a, b) => {
      if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

    const parent = nodePath.dirname(target)
    json(200, {
      path: target,
      parent: parent === target ? null : parent,
      home: os.homedir(),
      separator: nodePath.sep,
      entries,
    })
  })()
}
