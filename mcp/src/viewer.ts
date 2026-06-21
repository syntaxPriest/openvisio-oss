// `openvisio view [repo]` — the local, open-source graph viewer. Builds the
// deterministic graph with the SAME engine the MCP serves, then hosts a tiny
// localhost server that pairs the bundled Atlas + City UI (the openvisio-viewer
// package) with the existing spotlight HTTP surface: GET /api/graph?path=<repo>
// indexes on demand, and the SSE stream is mounted too, so a running
// `openvisio mcp --spotlight` session on the same port lights up the map live.
// Local-first: binds 127.0.0.1 only.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGraph } from '@openvisio/core'
import { toExportPayload } from './adapter.js'
import { startSpotlightServer, type SpotlightServer } from './spotlight.js'

export interface ViewerOptions {
  /** Repo to index and pre-load in the viewer. */
  rootPath: string
  /** Preferred port; the next free port is used if it's taken. */
  port: number
  /** Open the system browser at the viewer URL (default true). */
  open: boolean
}

/**
 * Locate the built `openvisio-viewer` assets (the Atlas + City React/Three app).
 * Primary path: resolve the installed package via node's resolver — works both
 * when openvisio depends on it (node_modules) and in the workspace. Falls back to
 * a few relative guesses for source/dev layouts. Returns null if it isn't built.
 */
function resolveViewerDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates: string[] = []
  try {
    const req = createRequire(import.meta.url)
    candidates.push(path.join(path.dirname(req.resolve('openvisio-viewer/package.json')), 'dist'))
  } catch {
    // not resolvable (unbuilt workspace, or odd install) — fall through to guesses
  }
  candidates.push(
    path.join(here, '..', '..', 'viewer', 'dist'), // mcp/dist → repo/viewer/dist
    path.join(here, '..', '..', '..', 'viewer', 'dist'),
    path.join(here, 'viewer'), // legacy bundled copy
  )
  for (const cand of candidates) {
    if (fs.existsSync(path.join(cand, 'index.html'))) return cand
  }
  return null
}

/** Open `url` in the system default browser (best-effort, never throws). */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // headless box / no opener — the URL is printed for the user to click.
  }
}

function isAddrInUse(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/**
 * Serve the viewer for `rootPath`, opening the browser at it. Runs until the
 * process is signalled. If the preferred port is busy, walks forward to the next
 * free one so two viewers (or a viewer + a spotlight hub) don't collide.
 */
export async function serveViewer(opts: ViewerOptions): Promise<void> {
  const root = path.resolve(opts.rootPath)
  const viewerDir = resolveViewerDir()
  if (!viewerDir) {
    process.stderr.write(
      'openvisio view: viewer assets not found. The `openvisio-viewer` package is missing or unbuilt.\n' +
        '  • installed globally: reinstall with `npm i -g openvisio@latest`\n' +
        '  • from the repo: run `npm run build -w openvisio-viewer` first\n',
    )
    process.exitCode = 1
    return
  }
  // On-demand indexer: empty path (the UI's first load can omit it) falls back
  // to the repo the command was launched from.
  const onIndex = async (repoPath: string) => toExportPayload(await buildGraph(repoPath || root), Date.now())

  let server: SpotlightServer | null = null
  let port = opts.port
  for (let i = 0; i < 16 && !server; i++) {
    try {
      server = await startSpotlightServer(port, 'mcp', onIndex, viewerDir)
    } catch (err) {
      if (isAddrInUse(err)) {
        port++
        continue
      }
      throw err
    }
  }
  if (!server) {
    process.stderr.write(`openvisio view: no free port in ${opts.port}..${opts.port + 16}\n`)
    process.exitCode = 1
    return
  }

  const url = `http://127.0.0.1:${server.port}/?path=${encodeURIComponent(root)}`
  const live =
    server.port === opts.port
      ? `  live: run \`openvisio mcp . --spotlight\` (or \`--port=${server.port}\`) and the agent's\n` +
        `        tool calls pulse the graph here\n`
      : `  note: port ${opts.port} was busy; serving on ${server.port}. For live agent\n` +
        `        highlights, start the agent with \`--spotlight --port=${server.port}\`\n`
  process.stderr.write(
    `openvisio view: indexing + serving ${root}\n` +
      `  ${url}\n` +
      `  (the path box in the UI indexes any other local repo)\n` +
      live +
      `  Ctrl-C to stop.\n`,
  )
  if (opts.open) openBrowser(url)

  const stop = () => {
    server?.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  await new Promise<void>(() => {}) // run until killed
}
