// MCP server wiring. Builds the repo graph ONCE at startup, holds it in memory,
// and exposes the tool surface over stdio — the transport Claude Code and Codex
// use to launch and talk to a local server. Optional `--watch` re-indexes
// changed files incrementally so the graph stays fresh mid-session; optional
// `--spotlight` lights up an open viewer. Local-first, read-only; only the
// spotlight binds a local (127.0.0.1) port.

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { computeCentrality, computeChurn, Indexer, type CodeGraph } from '@openvisio/core'
import { FileBufferedTelemetry } from './analytics.js'
import { SavingsReceipt } from './receipt.js'
import { startSpotlightServer, type SpotlightEvent, type SpotlightServer, type UserRequest } from './spotlight.js'
import { buildTools, type GraphState } from './tools.js'

export interface ServeOptions {
  /** Absolute or relative repo root to index. */
  rootPath: string
  /** Re-index changed files incrementally as the repo is edited. */
  watch?: boolean
  /** Start the spotlight SSE server so an open viewer highlights agent queries. */
  spotlight?: boolean
  /** Spotlight port (default 7077); ignored unless `spotlight` is set. */
  port?: number
  /** Persistent cache directory (LMDB); skips re-parsing unchanged files across restarts. */
  cacheDir?: string
}

/**
 * Build the path-keyed focus + edge payload for a spotlight event from the set
 * of files a tool touched. Edges are the import edges with BOTH endpoints in the
 * touched set (so the graph view emphasizes only relevant connections).
 */
function spotlightPayload(
  graph: CodeGraph,
  touchedFiles: number[],
): { focus: string[]; edges: [string, string][] } {
  const touched = new Set(touchedFiles)
  const focus: string[] = []
  for (const id of touchedFiles) {
    const f = graph.filesById.get(id)
    if (f) focus.push(f.path)
  }
  const edges: [string, string][] = []
  for (const e of graph.edges) {
    if (!touched.has(e.sourceId) || !touched.has(e.targetId)) continue
    const a = graph.filesById.get(e.sourceId)
    const b = graph.filesById.get(e.targetId)
    if (a && b) edges.push([a.path, b.path])
  }
  return { focus, edges }
}

// Directory segments whose changes never affect the graph — ignore their watch
// events so we don't re-index on dependency installs / build output churn.
const WATCH_IGNORE = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.turbo|coverage|__pycache__|\.venv|venv|target)(\/|$)/

/**
 * Build the graph for `rootPath` and start an MCP server over stdio. With
 * `watch`, an fs watcher re-indexes changed files and swaps the live state the
 * tools read. All diagnostics go to stderr — stdout is the MCP protocol stream.
 */
export async function serveMcp(opts: ServeOptions): Promise<void> {
  const resolvedRoot = path.resolve(opts.rootPath)
  const repoName = path.basename(resolvedRoot)
  const dbPath = opts.cacheDir ? path.join(opts.cacheDir, repoName.replace(/[^a-zA-Z0-9_-]/g, '_')) : undefined
  const indexer = new Indexer(opts.rootPath, {}, dbPath)

  // The graph is built AFTER the MCP transport connects (see below), so a large
  // repo — or being started in the wrong directory — never blocks the handshake
  // (which would otherwise leave the client stuck on "connecting…"). Until the
  // first index lands, `state` is null and tool calls await `ready`.
  let state: GraphState | null = null
  let buildError: string | null = null
  const getState = (): GraphState => {
    if (state) return state
    throw new Error(buildError ?? 'openvisio is still indexing this repository — retry in a moment.')
  }
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => {
    resolveReady = r
  })

  // Guard the classic footgun: the MCP "." path follows the editor's working
  // directory, so launching the editor in your HOME dir (or "/") would try to
  // index everything under it — effectively forever. Refuse, with a clear message.
  const badRoot = resolvedRoot === path.parse(resolvedRoot).root || resolvedRoot === path.resolve(os.homedir())

  const repoHash = createHash('sha256').update(resolvedRoot).digest('hex').slice(0, 12)
  const telemetry = new FileBufferedTelemetry({
    bufferDir: path.join(os.homedir(), '.local', 'share', 'openvisio', 'telemetry'),
    repoHash,
    endpointUrl: 'https://k5b3bh9hte.execute-api.us-east-1.amazonaws.com/dev/tool/telemetary',
  })

  const server = new McpServer(
    { name: 'openvisio', version: '0.1.5' },
    {
      instructions:
        'MANDATORY workflow for this repository. Before reading, grepping, globbing, ' +
        'or listing ANY file, you MUST first call openvisio tools to get structure. ' +
        'This is not optional and applies to EVERY task — exploration, edits, reviews, ' +
        'and debugging alike.\n' +
        '\n' +
        'Step 1 — ALWAYS call `resolve_context` first with the task description. It ' +
        'returns a task-ranked skeleton plus the neighborhoods of the most relevant ' +
        'files, every line carrying a `path:line` anchor.\n' +
        'Step 2 — drill in with the right tool instead of opening files:\n' +
        '  • find a function/class/type by name or pattern → `find_symbol`\n' +
        '  • who imports / what this imports (impact) → `get_dependents`\n' +
        '  • local import subgraph around a file/symbol → `get_neighborhood`\n' +
        '  • churn × centrality refactor/risk candidates → `get_hotspots`\n' +
        '  • the whole ranked repo map → `get_repo_skeleton`\n' +
        '\n' +
        'Only after these tools have given you the `path:line` anchors may you read ' +
        'source — and then read just the anchored slice, never the whole file. ' +
        'Do NOT reach for grep/glob/find/cat to discover code structure; that wastes ' +
        'tokens and bypasses the graph. The ONLY exceptions are non-code assets the ' +
        'graph does not model: config, docs/markdown, lockfiles, and binary/data files. ' +
        'When in doubt, call `resolve_context` first.',
    },
  )

  // Optional spotlight. We don't fight for the port: if another openvisio
  // spotlight already owns it (a standalone `openvisio spotlight` hub, or another
  // editor's session), we ATTACH and forward our highlights to it over HTTP so
  // the one open viewer lights up regardless of which session is querying.
  let spotlight: SpotlightLink | null = null
  if (opts.spotlight) {
    spotlight = await linkSpotlight(opts.port ?? 7077)
    if (spotlight) process.stderr.write(`openvisio mcp: spotlight ${spotlight.describe}\n`)
  }

  const receipt = new SavingsReceipt(() => getState().graph)

  // Under --spotlight, expose the reverse channel: agents can pull instructions
  // the developer composed in the viewer. Draining broadcasts a 'consumed' ack so
  // the viewer flips "queued" → "picked up".
  const toolDeps = spotlight
    ? {
        takeRequest: () => spotlight!.takeRequest(),
        // The return leg: broadcast the agent's reply as an 'answer' frame the
        // viewer correlates by requestId.
        postAnswer: (requestId: string, answer: string) => {
          spotlight!.emit({ v: 1, kind: 'answer', tool: 'agent', focus: [], edges: [], dim: false, requestId, answer })
        },
      }
    : undefined

  for (const tool of buildTools(getState, toolDeps)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      async (args: Record<string, unknown>) => {
        await ready
        const t0 = Date.now()
        try {
          const result = tool.handler(args)
          const latencyMs = Date.now() - t0
          telemetry.record(tool.name, latencyMs, result.text.length)
          receipt.record(result.text, result.touchedFiles)
          if (spotlight && result.touchedFiles.length > 0) {
            const { focus, edges } = spotlightPayload(getState().graph, result.touchedFiles)
            spotlight.emit({ v: 1, kind: 'highlight', tool: tool.name, focus, edges, dim: true })
          }
          return { content: [{ type: 'text' as const, text: result.text }] }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          telemetry.record(tool.name, Date.now() - t0, 0)
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
        }
      },
    )
  }

  // --watch re-indexes on file changes (debounced), swapping the live state so
  // subsequent tool calls reflect edits. It starts after the first index lands.
  let watcher: fs.FSWatcher | null = null

  // Print the savings receipt exactly once on shutdown. MCP clients terminate a
  // stdio server with SIGTERM (not a graceful stdin EOF), so we can't rely on
  // transport.onclose alone — hook the signals and the final exit too.
  let printed = false
  const printReceipt = () => {
    if (printed) return
    printed = true
    watcher?.close()
    spotlight?.close()
    indexer.close()
    telemetry.close()
    if (state) {
      const summary = receipt.summary()
      if (summary) process.stderr.write(summary + '\n')
    }
  }
  process.on('exit', printReceipt)
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      printReceipt()
      process.exit(0)
    })
  }

  const transport = new StdioServerTransport()
  transport.onclose = () => {
    printReceipt()
    process.exit(0)
  }
  await server.connect(transport)

  // Handshake is done — the client shows "connected" immediately. Now build the
  // graph; tool calls await `ready` and only run once the first index lands.
  if (badRoot) {
    buildError =
      `openvisio was started in ${resolvedRoot === path.resolve(os.homedir()) ? 'your home directory' : 'the filesystem root'} ` +
      `(${resolvedRoot}). Open your editor inside a project repository instead — the MCP "." path follows ` +
      `the editor's working directory, and indexing this location would never finish.`
    process.stderr.write('openvisio mcp: ' + buildError + '\n')
  } else {
    try {
      const started = process.hrtime.bigint()
      const graph = await indexer.build()
      const buildMs = Number(process.hrtime.bigint() - started) / 1e6
      // Churn is read once at startup (git history changes on commits, not saves);
      // graph + centrality are recomputed on every re-index.
      const churn = computeChurn(graph.rootPath)
      state = { graph, centrality: computeCentrality(graph), churn }
      process.stderr.write(
        `openvisio mcp: indexed ${graph.files.length} files, ${graph.symbols.length} symbols, ` +
          `${graph.edges.length} edges in ${buildMs.toFixed(0)}ms${opts.watch ? ' · watching' : ''}\n`,
      )
      if (opts.watch) {
        watcher = startWatcher(indexer, churn, (next, line) => {
          state = next
          process.stderr.write(line + '\n')
        })
      }
    } catch (err) {
      buildError = `openvisio failed to index this repository: ${err instanceof Error ? err.message : String(err)}`
      process.stderr.write('openvisio mcp: ' + buildError + '\n')
    }
  }
  resolveReady()

  // Keep the process alive until a shutdown path above fires.
  await new Promise<void>(() => {})
}

/**
 * A handle to the spotlight channel — uniform whether we OWN the port (in-process
 * bus + queue) or ATTACH to an openvisio spotlight already listening on it
 * (forward over HTTP). The server only ever calls emit / takeRequest / close.
 */
interface SpotlightLink {
  emit: (event: Omit<SpotlightEvent, 'ts'>) => void
  takeRequest: () => UserRequest | null
  close: () => void
  /** One-line status for the startup log. */
  describe: string
}

function isAddrInUse(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/** Probe GET /health; resolve the server's mode if it's an openvisio spotlight,
 *  else null (timeout, not ours, or unreachable). */
async function probeSpotlight(port: number): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 800)
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const body = (await res.json()) as { ok?: boolean; mode?: string }
    return body?.ok ? body.mode ?? 'mcp' : null
  } catch {
    return null
  }
}

/** Own the port if free; otherwise attach to an openvisio spotlight already on
 *  it; otherwise (foreign app on the port, or a non-EADDRINUSE error) disable. */
async function linkSpotlight(port: number): Promise<SpotlightLink | null> {
  try {
    return ownLink(await startSpotlightServer(port), port)
  } catch (err) {
    if (!isAddrInUse(err)) {
      process.stderr.write(`openvisio mcp: spotlight disabled (${err instanceof Error ? err.message : String(err)})\n`)
      return null
    }
  }
  const mode = await probeSpotlight(port)
  if (!mode) {
    process.stderr.write(`openvisio mcp: spotlight disabled (127.0.0.1:${port} in use by another app)\n`)
    return null
  }
  return remoteLink(port)
}

/** We own the port: emit + drain the in-process bus/queue directly. */
function ownLink(srv: SpotlightServer, port: number): SpotlightLink {
  return {
    emit: (event) => srv.bus.emit(event, Date.now()),
    takeRequest: () => {
      const now = Date.now()
      const r = srv.queue.take(now)
      if (r) {
        srv.bus.emit({ v: 1, kind: 'consumed', tool: 'agent', focus: [], edges: [], dim: false, requestId: r.id }, now)
      }
      return r
    },
    close: () => srv.close(),
    describe: `on http://127.0.0.1:${port}/api/spotlight`,
  }
}

/** Another openvisio spotlight owns the port: forward emits over HTTP, and drain
 *  the shared request queue with a background poller into a local buffer (so the
 *  synchronous takeRequest can serve it). The viewer tolerates a dropped frame. */
function remoteLink(port: number): SpotlightLink {
  const base = `http://127.0.0.1:${port}`
  const buf: UserRequest[] = []
  let stopped = false
  const poll = async () => {
    while (!stopped) {
      try {
        const res = await fetch(`${base}/api/request?consume=1`)
        const r = (await res.json()) as UserRequest | null
        if (r) {
          buf.push(r)
          continue // drain greedily while the queue is non-empty
        }
      } catch {
        // hub gone or busy — fall through to the backoff
      }
      await new Promise((r) => setTimeout(r, 1200))
    }
  }
  void poll()
  return {
    emit: (event) => {
      void fetch(`${base}/api/emit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, ts: Date.now() }),
      }).catch(() => {})
    },
    takeRequest: () => buf.shift() ?? null,
    close: () => {
      stopped = true
    },
    describe: `attached to the hub on 127.0.0.1:${port} (forwarding highlights)`,
  }
}

/**
 * Start a debounced recursive fs watcher. On a settled change it re-indexes
 * (reusing the parse cache + stable ids) and calls `onReindex` with the new
 * state and a one-line stderr summary. Overlapping events coalesce: a change
 * during an in-flight re-index queues exactly one more.
 */
function startWatcher(
  indexer: Indexer,
  churn: Map<string, number>,
  onReindex: (next: GraphState, line: string) => void,
): fs.FSWatcher | null {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pending = false

  const runReindex = async () => {
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      const t0 = process.hrtime.bigint()
      const { graph, changes } = await indexer.reindex()
      const total = changes.added.length + changes.removed.length + changes.changed.length
      if (total > 0) {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6
        onReindex(
          { graph, centrality: computeCentrality(graph), churn },
          `openvisio mcp: re-indexed (+${changes.added.length} ~${changes.changed.length} -${changes.removed.length}) ` +
            `→ ${graph.files.length} files, ${graph.edges.length} edges in ${ms.toFixed(0)}ms`,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`openvisio mcp: re-index failed (${msg})\n`)
    } finally {
      running = false
      if (pending) {
        pending = false
        void runReindex()
      }
    }
  }

  const onChange = (_event: fs.WatchEventType, filename: string | Buffer | null) => {
    const name = typeof filename === 'string' ? filename : filename?.toString() ?? ''
    if (name && WATCH_IGNORE.test(name.split('\\').join('/'))) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void runReindex()
    }, 200)
  }

  try {
    return fs.watch(indexer.absRoot, { recursive: true }, onChange)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`openvisio mcp: --watch unavailable (${msg}); serving a static index\n`)
    return null
  }
}
