#!/usr/bin/env node
// openvisio-instruct — UserPromptSubmit hook that INTERCEPTS the developer's
// next prompt and injects any instruction they composed in the open OpenVisio
// viewer. This is the "prompt interception" delivery path: type an instruction
// in the visuals, then your next message in this Claude Code session carries it
// (plus the files you selected) as context — no copy/paste, no tool call.
//
// It drains the standalone spotlight server's request queue
// (`GET /api/request?consume=1` on 127.0.0.1) and emits the result as
// `additionalContext`. The hook stays THIN on purpose: it injects the
// instruction + the selected @paths and tells the agent to call
// `get_user_request` / `resolve_context` to stage the ranked context — so the
// deterministic staging stays in the MCP tool (one source of truth).
//
// Fail-open everywhere: if no spotlight server is running (or anything errors),
// the prompt submits normally. A missing viewer must never wedge the agent.
//
// Install in the repo you point the agent at — .claude/settings.json:
//   {
//     "hooks": {
//       "UserPromptSubmit": [
//         { "hooks": [
//             { "type": "command",
//               "command": "node /ABS/PATH/TO/mcp/hooks/openvisio-instruct.mjs" }
//         ] }
//       ]
//     }
//   }
// UserPromptSubmit has no matcher — it fires on every prompt. Port follows
// OPENVISIO_SPOTLIGHT_PORT (default 7077), matching `openvisio mcp --port`.
//
// Relationship to the pull tool: the hook (?consume=1) and the get_user_request
// tool both drain the same queue. If both are installed the hook fires first and
// wins; the tool then reports "No pending viewer request" (benign).

import { readFileSync } from 'node:fs'

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function done(output) {
  if (output) process.stdout.write(JSON.stringify(output))
  process.exit(0)
}

let input = {}
try {
  input = JSON.parse(readStdin())
} catch {
  // Malformed hook payload → submit the prompt unchanged.
  done()
}

const port = process.env.OPENVISIO_SPOTLIGHT_PORT || '7077'

async function main() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  let req = null
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/request?consume=1`, {
      signal: controller.signal,
    })
    if (res.ok) req = await res.json()
  } catch {
    // No server / timeout / network error → fail open.
    req = null
  } finally {
    clearTimeout(timer)
  }

  if (!req || typeof req.instruction !== 'string') {
    done()
    return
  }

  const paths = Array.isArray(req.paths) ? req.paths.filter((p) => typeof p === 'string') : []
  const refs = paths.length ? paths.map((p) => `@${p}`).join(' ') : '(none)'
  const isQuestion = req.kind === 'question'
  const id = typeof req.id === 'string' ? req.id : ''
  const lines = [
    `The developer sent this ${isQuestion ? 'question' : 'instruction'} from the OpenVisio viewer:`,
    '',
    req.instruction,
    '',
    `Files they selected: ${refs}`,
    '',
    'To ground your response, call `resolve_context` on the text above (the openvisio graph tools are available).',
  ]
  if (isQuestion && id) {
    // The viewer is waiting for a reply — the agent MUST round-trip it back.
    lines.push(
      '',
      `This is a QUESTION. After answering, you MUST call \`submit_answer\` with ` +
        `request_id="${id}" and your answer text, so it appears back in the OpenVisio viewer.`,
    )
  }
  const additionalContext = lines.join('\n')

  done({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  })
}

main().catch(() => done())
