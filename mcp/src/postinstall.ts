// Runs automatically after `npm install`. On a GLOBAL install (`npm i -g
// openvisio`) it registers the MCP server for Claude Code / Codex / Cursor so
// the user never has to run a setup step. Strictly best-effort: it must NEVER
// fail the install, and it must NOT touch user config on a local/dependency
// install (only when npm reports a global install).
//
// Opt out with OPENVISIO_NO_POSTINSTALL=1. Imports only the core-free register
// module, so no native module (tree-sitter / lmdb) loads at install time.

import { runGlobalInit } from './register.js'

function main(): void {
  if (process.env.OPENVISIO_NO_POSTINSTALL) return

  // Only auto-register for global installs. npm sets npm_config_global=true for
  // `-g`; for a local install we stay silent so we never write a user's config
  // just because openvisio is a project dependency.
  const isGlobal = process.env.npm_config_global === 'true'
  if (!isGlobal) {
    process.stdout.write(
      'openvisio installed. Run `openvisio init --global` to register it for Claude Code / Codex / Cursor,\n' +
        'or `openvisio` inside a project to set up just that repo.\n',
    )
    return
  }

  try {
    runGlobalInit(true)
  } catch (err) {
    // Registration is a convenience — surface a hint, but exit clean so the
    // package still installs.
    process.stderr.write(
      `openvisio: auto-registration skipped (${err instanceof Error ? err.message : String(err)}).\n` +
        'Run `openvisio init --global` to finish setup.\n',
    )
  }
}

main()
