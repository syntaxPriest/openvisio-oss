// MCP registration: writing the config files that point coding agents at the
// openvisio server. Deliberately CORE-FREE — no @openvisio/core / tree-sitter /
// lmdb imports — so the npm `postinstall` hook can run it at install time
// without loading native modules. Project-scoped writes live in init.ts (which
// also indexes); this module owns the shared mergers + the global registration.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type Action = 'created' | 'updated' | 'unchanged'

// What every config points at: the globally-installed `openvisio` binary
// serving *the current project* over stdio, re-indexing incrementally as files
// change. The path is "." so a single global registration follows the agent
// into whatever repo it's launched in — the server resolves "." to the cwd the
// agent spawns it with (the project root).
//
// Deliberately WITHOUT `--spotlight`: this server is for grounding (the 6
// read-only query tools), and it's also what `claude` auto-starts when the
// hands-free agent answers. If it carried `--spotlight`, that nested server
// would attach to the agent's port and steal questions off the queue. The
// viewer↔agent reverse channel is owned by the hands-free agent (the "Start
// agent" pill) instead. Power users who want their EDITOR's Claude to answer
// viewer questions can add `--spotlight` to this command manually.
export const SERVER = { command: 'openvisio', args: ['mcp', '.', '--watch'] }

export const TICK: Record<Action, string> = {
  created: '✓',
  updated: '✓',
  unchanged: '·',
}

/** Merge `mcpServers.openvisio` into a JSON config, preserving everything else. */
export function mergeMcpJson(file: string, serversKey: string, entry: Record<string, unknown>): Action {
  let cfg: Record<string, unknown> = {}
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      // Unparseable user file: keep it safe, start fresh.
      fs.copyFileSync(file, `${file}.bak`)
      cfg = {}
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ [serversKey]: { openvisio: entry } }, null, 2) + '\n')
    return 'created'
  }
  const servers = (cfg[serversKey] ??= {}) as Record<string, unknown>
  if (JSON.stringify(servers.openvisio) === JSON.stringify(entry)) return 'unchanged'
  servers.openvisio = entry
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
  return 'updated'
}

/** Ensure a `[mcp_servers.openvisio]` table exists in a Codex-style TOML file.
 *  No TOML parser: we detect the table by header and append it if absent. A new
 *  table header at EOF is always valid TOML, so appending never corrupts. */
export function mergeCodexToml(file: string): Action {
  const block = ['[mcp_servers.openvisio]', 'command = "openvisio"', 'args = ["mcp", ".", "--watch"]'].join('\n')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, block + '\n')
    return 'created'
  }
  const cur = fs.readFileSync(file, 'utf8')
  if (/^\s*\[mcp_servers\.openvisio\]/m.test(cur)) return 'unchanged'
  const sep = cur.endsWith('\n') ? '\n' : '\n\n'
  fs.writeFileSync(file, cur + sep + block + '\n')
  return 'updated'
}

/** `openvisio init --global` — register the server once, for every project, at
 *  the user level. Writes Claude Code's user config (~/.claude.json), Codex's
 *  global TOML (~/.codex/config.toml) and Cursor's global JSON (~/.cursor/
 *  mcp.json). Each points at `openvisio mcp . --watch`, so the server indexes
 *  whatever repo the agent opens. No project index here — there's no project.
 *
 *  `quiet` trims the prose to two lines for the postinstall banner. */
export function runGlobalInit(quiet = false): number {
  const home = os.homedir()
  const out = (s: string) => process.stdout.write(s + '\n')

  out('')
  out('◆ openvisio — registering globally for every project')
  out('')

  // Claude Code: user-scoped server in ~/.claude.json (applies to all repos).
  const claude = mergeMcpJson(path.join(home, '.claude.json'), 'mcpServers', SERVER)
  out(`  ${TICK[claude]} ~/.claude.json ${claude === 'unchanged' ? 'already configured' : claude} — Claude Code, all projects`)

  // Codex: global ~/.codex/config.toml.
  const codex = mergeCodexToml(path.join(home, '.codex', 'config.toml'))
  out(`  ${TICK[codex]} ~/.codex/config.toml ${codex === 'unchanged' ? 'already configured' : codex} — Codex, all projects`)

  // Cursor: global ~/.cursor/mcp.json.
  const cursor = mergeMcpJson(path.join(home, '.cursor', 'mcp.json'), 'mcpServers', SERVER)
  out(`  ${TICK[cursor]} ~/.cursor/mcp.json ${cursor === 'unchanged' ? 'already configured' : cursor} — Cursor, all projects`)

  out('')
  if (quiet) {
    out('  Registered for Claude Code, Codex & Cursor. Open any repo and the agent')
    out('  auto-starts openvisio and queries the graph before reading files.')
    out('')
    return 0
  }
  out('  Done. Now, in ANY repo:')
  out('    · Claude Code / Codex / Cursor auto-start openvisio and call its tools first')
  out('    · the server indexes the repo you opened (the "." follows your cwd)')
  out('    · nothing to commit, nothing per-project to run')
  out('')
  out('  Claude Code users can equivalently run:')
  out('    claude mcp add --scope user openvisio -- openvisio mcp . --watch')
  out('')
  return 0
}
