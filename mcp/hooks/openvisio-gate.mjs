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
//   • Read/Grep/Glob for non-code files (configs, docs, lockfiles) are always
//     allowed without priming.
//   • All other code-discovery tools (Read/Grep/Glob on code, grep/find/etc.
//     in Bash) are DENIED until an openvisio tool primes the session.
//
// The first openvisio tool call in each task "primes" the session; after that
// all tools pass (anchored reads, git status, etc. all flow freely).
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
            'openvisio-gate: call the openvisio MCP first. Before searching code, ' +
            'call `resolve_context` with your task (then find_symbol / get_neighborhood ' +
            '/ get_dependents) to get path:line anchors. Then retry this action.',
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
// Rule 4: Ungated tools (non-Bash, non-Read/Grep/Glob) pass through.
// ---------------------------------------------------------------------------

const GATED_TOOLS = new Set(['Read', 'Grep', 'Glob'])
if (!GATED_TOOLS.has(toolName)) process.exit(0)

// ---------------------------------------------------------------------------
// Rule 5: Non-code file reads are always allowed.
// ---------------------------------------------------------------------------

if (isNonCodeRead(toolName, toolInput)) process.exit(0)

// ---------------------------------------------------------------------------
// Rule 6: Deny — call openvisio first.
// ---------------------------------------------------------------------------

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'openvisio-gate: call the openvisio MCP first. Before reading, grepping, or ' +
        'globbing any file in this repo, call `resolve_context` with your task (then ' +
        'find_symbol / get_neighborhood / get_dependents) to get path:line anchors. ' +
        'Then retry this action.',
    },
  }),
)
process.exit(0)
