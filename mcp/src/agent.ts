// `openvisio agent <repo>` — the hands-free answerer. It runs the spotlight
// server (queue + SSE the viewer connects to) AND a poll loop that, for each
// QUESTION the viewer asks, runs headless Claude (claude -p) and broadcasts the
// reply straight back to the viewer. One process = "the agent" the pill spins up.
//
// Port sharing: if another openvisio spotlight already owns the port (e.g. a
// Claude Code `openvisio mcp --spotlight` session), we ATTACH to it over HTTP —
// pulling its questions (consume=1) and posting answers (/api/emit) — instead of
// failing with EADDRINUSE. So auto-answering works no matter who owns the port.
//
// Only QUESTIONS are auto-answered (read-only); fire-and-forget instructions are
// left for a human's interactive session.

import { startSpotlightServer, type SpotlightEvent, type SpotlightServer } from './spotlight.js'
import { runClaudeAnswer } from './answerer.js'

export interface AgentOptions {
  rootPath: string
  port?: number
  cacheDir?: string
}

const POLL_MS = 1500

interface PulledRequest {
  id: string
  instruction: string
  paths: string[]
  kind?: string
}

function isAddrInUse(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/** Probe GET /health; return the owner's mode if it's an openvisio spotlight, else null. */
async function probeMode(base: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 800)
    const res = await fetch(`${base}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const body = (await res.json()) as { ok?: boolean; mode?: string }
    return body?.ok ? body.mode ?? 'mcp' : null
  } catch {
    return null
  }
}

export async function serveAgent(opts: AgentOptions): Promise<void> {
  const port = opts.port ?? 7077
  const base = `http://127.0.0.1:${port}`

  // Try to OWN the port; on EADDRINUSE, attach to the openvisio spotlight that
  // already owns it. Only bail if the port is held by a non-openvisio app.
  let owned: SpotlightServer | null = null
  try {
    owned = await startSpotlightServer(port, 'agent')
  } catch (e) {
    if (!isAddrInUse(e)) {
      process.stderr.write(`openvisio agent: could not start (${e instanceof Error ? e.message : String(e)})\n`)
      process.exit(1)
      return
    }
    const mode = await probeMode(base)
    if (!mode) {
      process.stderr.write(
        `openvisio agent: 127.0.0.1:${port} is in use by another app (not an openvisio spotlight). ` +
          `Free it (lsof -ti :${port} | xargs kill) or pass --port=<n>.\n`,
      )
      process.exit(1)
      return
    }
    process.stderr.write(`openvisio agent: attaching to the ${mode} spotlight already on ${base}\n`)
  }

  process.stderr.write(
    `openvisio agent: answering viewer questions about ${opts.rootPath} on ${base} ` +
      `(${owned ? 'serving' : 'attached'}, auto-answering with claude)\n`,
  )

  // Pull the next pending request — from our own queue, or the owner's over HTTP.
  const takeQuestion = async (): Promise<PulledRequest | null> => {
    if (owned) {
      const r = owned.queue.takeNextQuestion(Date.now())
      if (r) {
        owned.bus.emit({ v: 1, kind: 'consumed', tool: 'agent', focus: [], edges: [], dim: false, requestId: r.id }, Date.now())
      }
      return r
    }
    try {
      const res = await fetch(`${base}/api/request?consume=1`)
      return (await res.json()) as PulledRequest | null
    } catch {
      return null
    }
  }

  // Broadcast the reply — onto our own bus, or to the owner via /api/emit.
  // `done` marks the final frame; partial frames stream the answer as it builds.
  const postAnswer = async (requestId: string, answer: string, done: boolean) => {
    const event: Omit<SpotlightEvent, 'ts'> = { v: 1, kind: 'answer', tool: 'agent', focus: [], edges: [], dim: false, requestId, answer, done }
    if (owned) {
      owned.bus.emit(event, Date.now())
      return
    }
    try {
      await fetch(`${base}/api/emit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })
    } catch {
      /* hub vanished — the viewer will time out */
    }
  }

  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const req = await takeQuestion()
      if (!req) return
      // Attached mode pulls requests of ANY kind; only auto-answer questions.
      if (req.kind && req.kind !== 'question') return
      process.stderr.write(`openvisio agent: answering "${req.instruction.slice(0, 60)}"…\n`)
      // Stream the reply as it builds (throttled), then send the final frame.
      let lastEmit = 0
      const answer = await runClaudeAnswer(opts.rootPath, req.instruction, req.paths, (text) => {
        const now = Date.now()
        if (now - lastEmit >= 120) {
          lastEmit = now
          void postAnswer(req.id, text, false)
        }
      })
      await postAnswer(req.id, answer, true)
      process.stderr.write(`openvisio agent: answered ${req.id}\n`)
    } catch (e) {
      process.stderr.write(`openvisio agent: tick error — ${e instanceof Error ? e.message : String(e)}\n`)
    } finally {
      busy = false
    }
  }

  const interval = setInterval(() => void tick(), POLL_MS)
  const shutdown = () => {
    clearInterval(interval)
    owned?.close()
    process.exit(0)
  }
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(sig, shutdown)
  // Keep alive until a signal arrives.
  await new Promise<void>(() => {})
}
