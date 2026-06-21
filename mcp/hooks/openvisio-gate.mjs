#!/usr/bin/env node
// openvisio-gate — PreToolUse hook that ENFORCES "openvisio first".
//
// An MCP server's `instructions` field is only advisory; the model can ignore
// it. This hook is the deterministic layer: it hard-blocks code-discovery tools
// (Read / Grep / Glob, and grep/find/rg/ag/cat/sed/awk via Bash) until an
// openvisio MCP tool has been called at least once in the session. The first
// openvisio call "primes" the session; after that every tool passes (so the
// agent can read the anchored slices the graph pointed it at).
//
// Why prime-once-per-session and not per-read: a hook cannot see task
// boundaries, and gating every read forever would make anchored-slice reads
// impossible. Priming forces openvisio-FIRST deterministically; the strengthened
// server `instructions` carry the "every task" expectation from there.
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

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

let input = {}
try {
  input = JSON.parse(readStdin())
} catch {
  // Malformed hook payload → fail open (never wedge the agent).
  process.exit(0)
}

const sessionId = String(input.session_id || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '')
const marker = join(tmpdir(), `openvisio-primed-${sessionId}`)
const toolName = String(input.tool_name || '')

// Any openvisio tool primes the session and always passes.
if (toolName.startsWith('mcp__openvisio__')) {
  try {
    writeFileSync(marker, '1')
  } catch {
    /* best-effort; failing to write the marker only costs one extra nudge */
  }
  process.exit(0)
}

// Already primed → trust the agent (it may read anchored slices, run git, etc.).
if (existsSync(marker)) process.exit(0)

// Pre-prime: is this a code-discovery action we gate?
const GATED_TOOLS = new Set(['Read', 'Grep', 'Glob'])
let gated = GATED_TOOLS.has(toolName)
if (toolName === 'Bash') {
  const cmd = String(input.tool_input?.command || '')
  // Bash loopholes for code search: grep/rg/ag/ack/find/cat/sed/awk/head/tail/ls.
  gated = /\b(grep|rg|ag|ack|find|cat|sed|awk|head|tail|ls)\b/.test(cmd)
}

if (!gated) process.exit(0)

const reason =
  'openvisio-gate: call the openvisio MCP first. Before reading, grepping, or ' +
  'globbing any file in this repo, call `resolve_context` with your task (then ' +
  'find_symbol / get_neighborhood / get_dependents) to get path:line anchors. ' +
  'Then retry this action.'

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }),
)
process.exit(0)
