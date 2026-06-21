// Local graph engine route. Runs the deterministic OpenVisio CLI (`export`) on a
// local repo path and returns the viewer's GraphResponse + GroupGraphResponse —
// no LLM, no Mastra backend. This is the "one graph, two faces" bridge: the
// viewer renders exactly the graph the MCP server serves to coding agents.

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

// This route reads the local filesystem + spawns a process; it must run on the
// Node runtime, never the edge runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cliPath(): string {
  return process.env.OPENVISIO_CLI || path.resolve(process.cwd(), '..', 'mcp', 'dist', 'cli.js')
}

function isGraphFresh(outFile: string, repoPath: string): boolean {
  try {
    const graphStat = fs.statSync(outFile)
    // Compare against .git/index which git touches on any staged/committed change.
    // If .git/index doesn't exist (bare checkout, tarball), treat as stale.
    const ref = path.join(repoPath, '.git', 'index')
    const refStat = fs.statSync(ref)
    return graphStat.mtimeMs > refStat.mtimeMs
  } catch {
    return false
  }
}

export async function GET(req: Request): Promise<Response> {
  const repoPath = new URL(req.url).searchParams.get('path')
  if (!repoPath) {
    return Response.json({ error: 'Missing ?path=<repo path>' }, { status: 400 })
  }

  const graphDir = path.join(repoPath, '.openvisio')
  const outFile = path.join(graphDir, 'graph.json')

  // Serve cached graph if it's newer than the last git change.
  if (isGraphFresh(outFile, repoPath)) {
    try {
      const data = fs.readFileSync(outFile, 'utf8')
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      // Fall through to rebuild if read fails.
    }
  }

  // Ensure the output directory exists.
  try { fs.mkdirSync(graphDir, { recursive: true }) } catch { /* best effort */ }

  const nodeMem = process.env.OPENVISIO_NODE_MEM_MB || '2048'
  console.log(`[route] spawning: node --max-old-space-size=${nodeMem} export ${repoPath}`)
  const child = spawn('node', [`--max-old-space-size=${nodeMem}`, cliPath(), 'export', repoPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: repoPath,
  })
  console.log(`[route] child pid: ${child.pid}`)

  const stderrChunks: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  let aborted = false
  req.signal.addEventListener('abort', () => {
    console.log('[route] request aborted by client')
    aborted = true
    child.kill()
  })

  return new Promise((resolve) => {
    child.on('error', (err) => {
      console.log(`[route] child error: ${err.message}`)
      resolve(Response.json({ error: err.message }, { status: 500 }))
    })

    child.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      const cleanStderr = stderr.split('\n').filter(l => !l.includes('Aborted()')).join('\n').trim()
      console.log(`[route] child exited with code ${code}`)
      if (stderr) console.log(`[route] child stderr (raw length: ${stderr.length})`)
      if (cleanStderr) console.log(`[route] child stderr (filtered):\n${cleanStderr}`)
      if (aborted) return
      if (code !== 0) {
        const msg = cleanStderr.slice(0, 500) || `export failed (exit ${code})`
        resolve(Response.json({ error: msg }, { status: 500 }))
        return
      }
      try {
        console.log(`[route] reading ${outFile}`)
        const data = fs.readFileSync(outFile, 'utf8')
        console.log(`[route] success: ${(data.length / 1024 / 1024).toFixed(1)} MB`)
        resolve(new Response(data, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error reading output'
        const detail = cleanStderr.slice(0, 500)
        console.log(`[route] read error: ${msg}`)
        resolve(Response.json({ error: `${msg} — stderr: ${detail}` }, { status: 500 }))
      }
    })
  })
}
