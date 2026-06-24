// `openvisio transport [path]` — index a repo LOCALLY, then ship just the graph
// JSON to a web server that renders it. This is the local-repo half of the hosted
// viewer: the heavy work (clone-free filesystem scan + tree-sitter parse) happens
// on your machine where it's fast and private; the server only stores + renders a
// pre-computed graph (no git, no indexing, no source upload).
//
// Flow: build the graph → write .openvisio/graph.json → POST it to
// <server>/api/import → open <server>/?g=<id> (the rendered graph + narrator).

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildGraph } from '@openvisio/core'
import { toExportPayload } from './adapter.js'

export interface TransportOptions {
  /** Repo to index. */
  rootPath: string
  /** Web server base URL, e.g. https://openvisio.io (no trailing slash). */
  server: string
  /** Also write the graph to this file (default <repo>/.openvisio/graph.json). */
  out?: string
  /** Open the system browser at the rendered URL (default true). */
  open: boolean
}

/** Add `.openvisio/` to the repo's .gitignore once (best-effort). */
function ensureGitIgnore(root: string): void {
  const gitignorePath = path.join(root, '.gitignore')
  const entry = '.openvisio/'
  let content = ''
  try {
    content = fs.readFileSync(gitignorePath, 'utf8')
  } catch {
    /* no .gitignore — will create */
  }
  if (content.split(/\r?\n/).some((l) => l.trim() === entry)) return
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n'
  try {
    fs.writeFileSync(gitignorePath, content + sep + entry + '\n')
  } catch {
    /* read-only fs — fine */
  }
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
    /* headless box — the URL is printed for the user */
  }
}

export async function runTransport(opts: TransportOptions): Promise<number> {
  const root = path.resolve(opts.rootPath)
  const server = opts.server.replace(/\/+$/, '')

  // 1. Index locally.
  process.stderr.write(`openvisio transport: indexing ${root} …\n`)
  const started = process.hrtime.bigint()
  const graph = await buildGraph(root)
  const payload = toExportPayload(graph, Date.now())
  const json = JSON.stringify(payload)
  const buildMs = Number(process.hrtime.bigint() - started) / 1e6
  process.stderr.write(
    `openvisio transport: indexed ${graph.files.length} files, ${graph.symbols.length} symbols, ` +
      `${graph.edges.length} edges in ${buildMs.toFixed(0)}ms (${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)} MB)\n`,
  )

  // 2. Write the graph to the local .openvisio folder (cache + offline copy).
  const outFile = opts.out ?? path.join(root, '.openvisio', 'graph.json')
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, json)
    ensureGitIgnore(root)
    process.stderr.write(`openvisio transport: wrote ${outFile}\n`)
  } catch (err) {
    process.stderr.write(`openvisio transport: could not write ${outFile} (${err instanceof Error ? err.message : String(err)})\n`)
  }

  // 3. Upload the graph JSON to the server.
  process.stderr.write(`openvisio transport: uploading to ${server}/api/import …\n`)
  let res: Response
  try {
    res = await fetch(`${server}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Openvisio-Name': graph.name },
      body: json,
    })
  } catch (err) {
    process.stderr.write(`openvisio transport: upload failed — could not reach ${server} (${err instanceof Error ? err.message : String(err)})\n`)
    return 1
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    process.stderr.write(`openvisio transport: upload rejected (${res.status}) ${detail.slice(0, 200)}\n`)
    return 1
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string }
  if (!body.id && !body.url) {
    process.stderr.write('openvisio transport: server did not return an id/url\n')
    return 1
  }

  // 4/5. Open the rendered graph + narrator.
  const viewUrl = body.url ?? `${server}/?g=${encodeURIComponent(body.id!)}`
  process.stderr.write(`openvisio transport: live at\n  ${viewUrl}\n`)
  if (opts.open) openBrowser(viewUrl)
  return 0
}
