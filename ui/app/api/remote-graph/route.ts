// Remote repo graph. Shallow-clones a Git URL into a per-URL cache dir, then
// runs the SAME deterministic OpenVisio engine the local route uses and returns
// the viewer's GraphResponse + GroupGraphResponse. Repeat opens of the same URL
// reuse the checkout. Local-first: the clone lives under the OS temp dir on the
// user's own machine; no data leaves it beyond the git fetch.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cliPath(): string {
  return process.env.OPENVISIO_CLI || path.resolve(process.cwd(), '..', 'mcp', 'dist', 'cli.js')
}

// Accept the common Git URL forms; reject everything else (no file://, no shell).
const GIT_URL = /^(https?:\/\/|git@[\w.-]+:|ssh:\/\/|git:\/\/)/i

interface RunResult {
  code: number
  stderr: string
}

// spawn without a shell (args are an array, so no injection) + a timeout and an
// abort hook so a cancelled request kills the child.
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    const chunks: Buffer[] = []
    child.stderr.on('data', (c: Buffer) => chunks.push(c))
    let done = false
    const finish = (code: number) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stderr: Buffer.concat(chunks).toString('utf8') })
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      finish(125)
    }
    const timer = opts.timeoutMs ? setTimeout(() => { child.kill('SIGKILL'); finish(124) }, opts.timeoutMs) : null
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', () => finish(127)) // e.g. git/node not on PATH
    child.on('close', (code) => finish(code ?? 1))
  })
}

function repoName(url: string): string {
  const m = url.replace(/\.git$/, '').match(/([^/:]+?)\/?$/)
  return (m?.[1] || 'repo').replace(/[^a-zA-Z0-9_.-]/g, '-')
}

// Extensions the scanner never turns into useful graph nodes (binary, media,
// archives, and the CAD/3D/EDA formats that dominate hardware repos). We drop
// them from the CHECKOUT via sparse-checkout, so a giant design repo (e.g.
// nasa-jpl/open-source-rover is ~3 GB of STL/STEP/PDF) downloads only the few
// MB of source we actually read — turning a clone timeout into a few seconds.
// Mirrors core's BINARY_EXTS plus heavy engineering formats.
const BINARY_EXTS = [
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'tif', 'avif', 'heic', 'psd', 'ai', 'sketch',
  // video / audio
  'mp4', 'mov', 'avi', 'webm', 'mkv', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // archives / disk images
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'rar', '7z', 'iso', 'dmg',
  // compiled / binary objects / data
  'jar', 'war', 'ear', 'class', 'so', 'dylib', 'dll', 'exe', 'bin', 'dat', 'wasm', 'node',
  'pyc', 'pyo', 'o', 'a', 'lib', 'obj', 'parquet', 'avro', 'orc', 'db', 'sqlite', 'sqlite3', 'mdb', 'pdf',
  // CAD / 3D / EDA
  'stl', 'step', 'stp', 'igs', 'iges', '3mf', 'fbx', 'blend', 'dwg', 'dxf', 'sldprt', 'sldasm', 'prt',
  'f3d', 'f3z', 'ipt', 'iam', 'catpart', 'catproduct', 'x_t', 'x_b', 'sat', 'glb', 'gltf', '3ds', 'ply', 'dae',
]

// Sparse-checkout patterns: include everything, then exclude the binary
// extensions (both cases — case-sensitive filesystems match exactly).
function sparsePatterns(): string[] {
  const pats = ['/*']
  for (const e of BINARY_EXTS) pats.push(`!*.${e}`, `!*.${e.toUpperCase()}`)
  return pats
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams
  const url = (sp.get('url') ?? '').trim()
  const ref = (sp.get('ref') ?? '').trim()
  if (!url) return Response.json({ error: 'Missing ?url=<git url>' }, { status: 400 })
  if (!GIT_URL.test(url)) {
    return Response.json({ error: 'Not a valid Git URL — use https://…, git@…, or ssh://…' }, { status: 400 })
  }

  // Stable clone dir per (url, ref) so repeat opens reuse the checkout. The hash
  // goes in a PARENT dir so the checkout itself keeps the clean repo name — the
  // engine derives the displayed repo name from the directory basename.
  const key = createHash('sha1').update(`${url}#${ref}`).digest('hex').slice(0, 16)
  const parent = path.join(os.tmpdir(), 'openvisio-remote', key)
  const dir = path.join(parent, repoName(url))
  try {
    fs.mkdirSync(parent, { recursive: true })
  } catch {
    /* best effort */
  }

  const cloned = fs.existsSync(path.join(dir, '.git'))
  if (!cloned) {
    fs.rmSync(dir, { recursive: true, force: true }) // clear any partial clone

    // Fast path: a blobless partial clone with NO checkout (fetches only commit
    // + tree metadata — seconds, even for multi-GB repos), then a sparse
    // checkout that materializes only non-binary files. The huge CAD/media/
    // archive blobs we'd discard anyway are never downloaded.
    const cloneArgs = ['clone', '--depth', '1', '--single-branch', '--no-tags', '--filter=blob:none', '--no-checkout']
    if (ref) cloneArgs.push('--branch', ref)
    cloneArgs.push(url, dir)
    let res = await run('git', cloneArgs, { timeoutMs: 300_000, signal: req.signal })
    if (res.code === 0) {
      await run('git', ['-C', dir, 'sparse-checkout', 'set', '--no-cone', ...sparsePatterns()], {
        timeoutMs: 30_000,
        signal: req.signal,
      })
      res = await run('git', ['-C', dir, 'checkout'], { timeoutMs: 300_000, signal: req.signal })
    }

    // Fallback: a server without partial-clone support (or git too old) fails
    // fast — retry with a plain shallow clone. Skip on timeout/abort (a second
    // full clone wouldn't help) and when git is missing.
    if (res.code !== 0 && !req.signal.aborted && res.code !== 124 && res.code !== 125 && res.code !== 127) {
      fs.rmSync(dir, { recursive: true, force: true })
      const plain = ['clone', '--depth', '1', '--single-branch', '--no-tags']
      if (ref) plain.push('--branch', ref)
      plain.push(url, dir)
      res = await run('git', plain, { timeoutMs: 300_000, signal: req.signal })
    }

    if (req.signal.aborted) return new Response(null, { status: 499 })
    if (res.code !== 0) {
      fs.rmSync(dir, { recursive: true, force: true })
      if (res.code === 127) return Response.json({ error: 'git is not installed or not on PATH' }, { status: 500 })
      const tail = res.stderr.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 400)
      const why = res.code === 124 ? 'clone timed out' : tail || 'git clone failed'
      return Response.json({ error: `Could not clone ${url} — ${why}` }, { status: 502 })
    }
  } else if (sp.get('refresh') === '1') {
    await run('git', ['fetch', '--depth', '1', 'origin'], { cwd: dir, timeoutMs: 120_000, signal: req.signal })
    await run('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: dir, timeoutMs: 30_000, signal: req.signal })
  }

  // Index the clone with the same engine + output the local route reads.
  const graphDir = path.join(dir, '.openvisio')
  const outFile = path.join(graphDir, 'graph.json')
  try {
    fs.mkdirSync(graphDir, { recursive: true })
  } catch {
    /* best effort */
  }
  const nodeMem = process.env.OPENVISIO_NODE_MEM_MB || '2048'
  const res = await run('node', [`--max-old-space-size=${nodeMem}`, cliPath(), 'export', dir], {
    cwd: dir,
    timeoutMs: 300_000,
    signal: req.signal,
  })
  if (req.signal.aborted) return new Response(null, { status: 499 })
  if (res.code !== 0) {
    // A V8 abort (code > 128) or WASM/heap fatal means a language grammar is
    // incompatible with this Node build — surface something actionable, not a
    // raw crash dump. (Swift is skipped by default for exactly this reason.)
    const crashed = res.code > 128 || /FATAL ERROR|wasm::|DefaultJobWorker|out of memory/i.test(res.stderr)
    if (crashed) {
      return Response.json(
        {
          error:
            'Indexing crashed while parsing this repo — a language grammar is incompatible with your Node build. ' +
            'Set OPENVISIO_DISABLE_GRAMMARS=<lang> to skip it, then retry (Swift is already skipped by default).',
        },
        { status: 500 },
      )
    }
    const detail = res.stderr
      .split('\n')
      .filter((l) => !l.includes('Aborted()'))
      .filter(Boolean)
      .slice(-4)
      .join('\n')
      .slice(0, 500)
    return Response.json({ error: detail || `index failed (exit ${res.code})` }, { status: 500 })
  }
  try {
    const data = fs.readFileSync(outFile, 'utf8')
    return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'failed to read graph output' }, { status: 500 })
  }
}
