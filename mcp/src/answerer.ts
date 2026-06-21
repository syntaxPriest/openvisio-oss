// Headless answerer: runs `claude -p` (non-interactive Claude Code) to answer a
// viewer question, grounded in the repo via the openvisio MCP tools. Read-only
// — only the openvisio query tools + Read/Grep/Glob are allowed, so an
// auto-answer can never modify the codebase.

import { spawn } from 'node:child_process'

// The Claude Code CLI to invoke. Defaults to `claude` on PATH; override with a
// full path when it isn't resolvable from the (often minimal) env the agent is
// spawned under — e.g. OPENVISIO_CLAUDE_BIN=/Users/me/.local/bin/claude.
const CLAUDE_BIN = process.env.OPENVISIO_CLAUDE_BIN || process.env.CLAUDE_BIN || 'claude'

// Cap a single answer so a wedged claude resolves with an error instead of
// leaving the viewer stuck on "Asking the coding agent…". Override via env.
const ANSWER_TIMEOUT_MS = Number(process.env.OPENVISIO_AGENT_TIMEOUT_MS) || 180_000

const READONLY_TOOLS = [
  'mcp__openvisio__resolve_context',
  'mcp__openvisio__find_symbol',
  'mcp__openvisio__get_neighborhood',
  'mcp__openvisio__get_dependents',
  'mcp__openvisio__get_repo_skeleton',
  'mcp__openvisio__get_hotspots',
  'Read',
  'Grep',
  'Glob',
]

/** Run claude -p in `repoPath` to answer `question`; resolves to the reply text.
 *  `onDelta` (optional) is called with the accumulated answer as it streams, so
 *  the viewer can show the reply building up instead of waiting for the end. */
export function runClaudeAnswer(
  repoPath: string,
  question: string,
  paths: string[],
  onDelta?: (text: string) => void,
): Promise<string> {
  const focus = paths.length
    ? `\n\nThe developer selected these files in the viewer: ${paths.map((p) => '@' + p).join(' ')}`
    : ''
  const prompt =
    `You are answering a question coming from the OpenVisio code visualizer about this repository. ` +
    `Ground your answer in the real code using the openvisio tools (resolve_context first, then find_symbol / ` +
    `get_neighborhood / get_dependents) and by reading the relevant files. ` +
    `Write a thorough, in-depth explanation — several paragraphs. Walk through the relevant files and how they ` +
    `connect, name the key functions/types/components with their file paths (path:line where useful), and ` +
    `explain the WHY — design intent, data flow, and edge cases — not just the what. Prefer completeness over ` +
    `brevity; do not give a one-line answer. Plain prose, with short headings or bullet lists where they aid ` +
    `clarity. Do NOT modify any files.` +
    `\n\nQuestion: ${question}${focus}`

  return new Promise((resolve) => {
    const notFound = (msg: string) =>
      `(could not run "${CLAUDE_BIN}": ${msg}. Install Claude Code (npm i -g @anthropic-ai/claude-code) ` +
      `or set OPENVISIO_CLAUDE_BIN to its full path.)`

    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (reply: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(reply)
    }

    let child
    try {
      // --allowedTools takes ONE value (comma-separated); passing each tool as a
      // separate argv turns the rest into stray positional args.
      child = spawn(CLAUDE_BIN, ['-p', prompt, '--allowedTools', READONLY_TOOLS.join(',')], {
        cwd: repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      done(notFound(e instanceof Error ? e.message : String(e)))
      return
    }

    // Never leave the viewer hanging: a wedged/unauthenticated `claude -p` (it
    // can sit waiting instead of erroring) would otherwise never resolve.
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      done(
        `(claude timed out after ${ANSWER_TIMEOUT_MS / 1000}s — is it installed and signed in? ` +
          `Test it in a terminal: ${CLAUDE_BIN} -p "hi")`,
      )
    }, ANSWER_TIMEOUT_MS)

    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d
      if (out.trim()) onDelta?.(out)
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      const text = out.trim()
      if (text) return done(text)
      const detail = err.trim().slice(0, 300)
      done(`(no answer from ${CLAUDE_BIN}${detail ? `: ${detail}` : code ? ` — exited ${code}` : ''})`)
    })
    child.on('error', (e) =>
      done('code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT' ? notFound('not found on PATH') : `(could not run "${CLAUDE_BIN}": ${e.message})`),
    )
  })
}
