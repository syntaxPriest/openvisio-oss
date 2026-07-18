#!/usr/bin/env node
// openvisio-gate — PreToolUse hook that ENFORCES "openvisio first" PER TASK.
//
// An MCP server's `instructions` field is only advisory; the model can ignore
// it. This hook is the deterministic layer:
//
//   • Write Bash commands (edits, builds, commits) signal a task boundary and
//     clear the "primed" marker, forcing the agent to call resolve_context
//     again on the next task.
//   • Write commands also delete .openvisio/graph.json so the viewer
//     re-indexes on the next request.
//   • Read is ALWAYS allowed — the goal is to reduce blind whole-file reads, not
//     to block reading. Agents still read the anchored slices the tools hand
//     them; we just don't gate Read itself.
//   • Grep/Glob for non-code files (configs, docs, lockfiles) are always allowed
//     without priming.
//   • The SEARCH tools (Grep/Glob on code, grep/find/etc. in Bash) are DENIED
//     until an openvisio tool primes the session — steering discovery to
//     search_code / find_symbol / trace_calls instead of blind text sweeps.
//
// The first openvisio tool call in each task "primes" the session; after that
// all tools pass (search, git status, etc. all flow freely).
//
// Install in the repo you point the agent at — .claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [
//         {
//           "matcher": "Read|Grep|Glob|Bash|mcp__openvisio__.*",
//           "hooks": [
//             { "type": "command",
//               "command": "node /ABS/PATH/TO/mcp/hooks/openvisio-gate.mjs" }
//           ]
//         }
//       ]
//     }
//   }
// The matcher MUST include `mcp__openvisio__.*` so the hook also sees openvisio
// calls and can prime the session.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/** Known READ-ONLY Bash commands — everything else is treated as a write
 *  (task-boundary signal). */
const READONLY_BASH = /\b(grep|rg|ag|ack|find|cat|head|tail|wc|diff|echo|pwd|which|type|file|du|df|ls)\b/

/** Bash commands that do code search — these are GATED (denied before prime)
 *  just like Read/Grep/Glob. A subset of non-readonly Bash. */
const SEARCH_BASH = /\b(grep|rg|ag|ack|find|cat|sed|awk|head|tail|ls)\b/

/** File extensions that are never code — reading these is always allowed. */
const NON_CODE_EXT = /\.(md|json|yaml|yml|toml|lock|txt|cfg|ini|env|gitignore|dockerignore|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|eot|csv|sql|log)$/i

function isNonCodeRead(toolName, toolInput) {
  if (toolName === 'Read') {
    const path = String(toolInput?.file_path || toolInput?.path || '')
    return NON_CODE_EXT.test(path)
  }
  if (toolName === 'Grep') {
    // Grep config/docs files — typically --include or a path ending in a
    // non-code extension in the second arg. Heuristic: if the pattern itself
    // is short and not a code construct, allow. Simpler: always allow Grep
    // on paths that look like non-code.
    const include = String(toolInput?.include || '')
    const path = String(toolInput?.path || '')
    return NON_CODE_EXT.test(include || path)
  }
  if (toolName === 'Glob') {
    const pattern = String(toolInput?.pattern || '')
    return NON_CODE_EXT.test(pattern)
  }
  return false
}

function deleteIfExists(file) {
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch {
    /* best-effort */
  }
}

function repoRoot() {
  // Walk up from cwd looking for .git or .openvisio.
  let dir = process.cwd()
  if (!dir.endsWith('/')) dir += '/'
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.openvisio'))) {
      return dir.replace(/\/$/, '')
    }
    const parent = join(dir, '..')
    if (parent === dir || parent.length >= dir.length) break
    dir = parent
  }
  return process.cwd()
}

// ---------------------------------------------------------------------------
// Parse hook input
// ---------------------------------------------------------------------------

let input = {}
try {
  input = JSON.parse(readStdin())
} catch {
  process.exit(0)
}

const sessionId = String(input.session_id || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '')
const marker = join(tmpdir(), `openvisio-primed-${sessionId}`)
const toolName = String(input.tool_name || '')
const toolInput = input.tool_input || {}

// ---------------------------------------------------------------------------
// Rule 1: openvisio MCP tools always pass AND prime the session.
// ---------------------------------------------------------------------------

if (toolName.startsWith('mcp__openvisio__')) {
  try {
    writeFileSync(marker, '1')
  } catch {
    /* best-effort */
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Rule 2: Bash write commands signal a task boundary.
//         Clear the prime + delete stale graph.json.
// ---------------------------------------------------------------------------

if (toolName === 'Bash') {
  const cmd = String(toolInput.command || '')

  // Not a write command → pass through (may still be gated as search below).
  if (!READONLY_BASH.test(cmd)) {
    // Write command detected — clear the prime marker for per-task gating.
    deleteIfExists(marker)
    // Also blow away the viewer's stale cached graph.
    deleteIfExists(join(repoRoot(), '.openvisio', 'graph.json'))
  }

  // Gate search commands before priming (same as pre-prime Read/Grep/Glob).
  if (existsSync(marker)) process.exit(0)
  if (SEARCH_BASH.test(cmd)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'openvisio-gate: use the openvisio MCP instead of grep/rg/find. For text ' +
            'search call `search_code` (the grep replacement — ranked, anchored, ' +
            'symbol-annotated hits). To orient first, call `resolve_context`, then ' +
            'find_symbol / get_neighborhood / get_dependents for path:line anchors.',
        },
      }),
    )
    process.exit(0)
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Rule 3: Already primed for this task → everything passes.
// ---------------------------------------------------------------------------

if (existsSync(marker)) process.exit(0)

// ---------------------------------------------------------------------------
// Rule 4: Read always passes, and any other ungated tool (non-Bash, non-Grep/
// Glob) passes through. Reading is never blocked — we only steer SEARCH.
// ---------------------------------------------------------------------------

const GATED_TOOLS = new Set(['Grep', 'Glob'])
if (!GATED_TOOLS.has(toolName)) process.exit(0)

// ---------------------------------------------------------------------------
// Rule 5: Grep/Glob over non-code files (configs, docs, lockfiles) are allowed.
// ---------------------------------------------------------------------------

if (isNonCodeRead(toolName, toolInput)) process.exit(0)

// ---------------------------------------------------------------------------
// Rule 6: Deny the SEARCH (Grep/Glob over code) — call openvisio first.
// (Read is never gated; this only catches blind text/glob sweeps.)
// ---------------------------------------------------------------------------

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'openvisio-gate: use the openvisio MCP for code search instead of Grep/Glob. ' +
        'For text search call `search_code` (the grep replacement); for a symbol by ' +
        'name/concept use `find_symbol`; for callers use `trace_calls`. To orient, call ' +
        '`resolve_context` first. Reading files is always allowed. Then retry this action.',
    },
  }),
)
process.exit(0)
