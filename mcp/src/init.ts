// `openvisio` (bare, or `openvisio init`) — one-command project setup. Writes
// the project-scoped MCP configs so coding agents auto-start the server, then
// runs a first index so the user sees the graph exists. Idempotent: re-running
// only reports "already configured". Read-only everywhere except the config
// files it owns; never touches global state.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildGraph } from '@openvisio/core'
import { mergeMcpJson, SERVER, TICK } from './register.js'

// The global registration (`openvisio init --global`) lives in the core-free
// register module so the postinstall hook can reuse it; re-export for the CLI.
export { runGlobalInit } from './register.js'

export interface InitOptions {
  rootPath: string
  /** Also write .cursor/mcp.json even when no .cursor/ directory exists. */
  cursor?: boolean
}

export async function runInit(opts: InitOptions): Promise<number> {
  const root = path.resolve(opts.rootPath)
  const out = (s: string) => process.stdout.write(s + '\n')

  out('')
  out('◆ openvisio — wiring this project for graph-native agents')
  out('')

  // Claude Code: project-scoped .mcp.json (committed, shared with the team).
  const claude = mergeMcpJson(path.join(root, '.mcp.json'), 'mcpServers', SERVER)
  out(`  ${TICK[claude]} .mcp.json ${claude === 'unchanged' ? 'already configured' : claude} — Claude Code auto-starts the server here`)

  // Cursor: same shape, project-scoped under .cursor/. Only when Cursor is in
  // use (or forced), so we don't litter non-Cursor projects.
  if (opts.cursor || fs.existsSync(path.join(root, '.cursor'))) {
    const cursor = mergeMcpJson(path.join(root, '.cursor', 'mcp.json'), 'mcpServers', SERVER)
    out(`  ${TICK[cursor]} .cursor/mcp.json ${cursor === 'unchanged' ? 'already configured' : cursor} — Cursor`)
  }

  // VS Code (Copilot agent mode): .vscode/mcp.json with its own schema.
  if (fs.existsSync(path.join(root, '.vscode'))) {
    const vscode = mergeMcpJson(path.join(root, '.vscode', 'mcp.json'), 'servers', { type: 'stdio', ...SERVER })
    out(`  ${TICK[vscode]} .vscode/mcp.json ${vscode === 'unchanged' ? 'already configured' : vscode} — VS Code`)
  }

  // First index — proves the graph builds and shows the scale of what's served.
  try {
    const started = process.hrtime.bigint()
    const graph = await buildGraph(root)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    out(
      `  ✓ indexed ${graph.files.length} files · ${graph.symbols.length.toLocaleString('en-US')} symbols · ` +
        `${graph.edges.length.toLocaleString('en-US')} import edges in ${(ms / 1000).toFixed(1)}s`,
    )
  } catch (err) {
    out(`  ✗ first index failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  out('')
  out('  Next:')
  out('    · open Claude Code in this folder and approve the "openvisio" server')
  out('    · agents now call resolve_context / find_symbol / get_hotspots instead of crawling')
  out('    · run the server by hand any time:  openvisio mcp . --watch')
  out('')
  out('  Codex uses a global config — add this to ~/.codex/config.toml:')
  out('    [mcp_servers.openvisio]')
  out('    command = "openvisio"')
  out(`    args = ["mcp", "${root}", "--watch"]`)
  out('')
  out('  Tip: run  openvisio init --global  once to register openvisio for EVERY')
  out('  project at the user level (Claude Code, Codex, Cursor) — no per-repo setup.')
  out('')
  return 0
}
