#!/usr/bin/env node
// OpenVisio CLI entry point. Two faces of one index:
//   openvisio                                 → set this project up (auto-add MCP)
//   openvisio skeleton [path] [--budget=N]    → print the ranked repo skeleton
//   openvisio mcp [path]                      → serve the graph over MCP (stdio)
// Local-first, read-only, no network.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildGraph, buildSkeleton, rankForTask } from '@openvisio/core'
import { toExportPayload } from './adapter.js'
import { serveMcp } from './server.js'
import { serveAgent } from './agent.js'
import { serveViewer } from './viewer.js'
import { runTransport } from './transport.js'
import { startSpotlightServer } from './spotlight.js'
import { runInit, runGlobalInit } from './init.js'

// Exit quietly when stdout closes early (`openvisio | head`), like any good CLI.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

function ensureGitIgnore(root: string): void {
  const gitignorePath = path.join(root, '.gitignore')
  const entry = '.openvisio/'
  let content = ''
  try {
    content = fs.readFileSync(gitignorePath, 'utf8')
  } catch {
    // file doesn't exist — will create below
  }
  if (!content.split(/\r?\n/).some((line) => line.trim() === entry)) {
    const toWrite =
      content.endsWith('\n') || content.length === 0
        ? content + entry + '\n'
        : content + '\n' + entry + '\n'
    fs.writeFileSync(gitignorePath, toWrite)
  }
}

interface ParsedArgs {
  command: string | undefined
  positional: string[]
  flags: Map<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Map<string, string>()
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq === -1) flags.set(arg.slice(2), 'true')
      else flags.set(arg.slice(2, eq), arg.slice(eq + 1))
    } else {
      positional.push(arg)
    }
  }
  return { command: positional[0], positional: positional.slice(1), flags }
}

function printUsage(): void {
  process.stderr.write(
    [
      'openvisio — token-cheap code-graph for coding agents',
      '',
      'Usage:',
      '  openvisio [init] [path] [--cursor]',
      '      Set the current project up: writes the project-scoped MCP configs',
      '      (.mcp.json for Claude Code; .cursor/.vscode when present) so agents',
      '      auto-start the server, then runs a first index. Idempotent.',
      '',
      '  openvisio init --global',
      '      Register openvisio ONCE for every project, at the user level:',
      '      ~/.claude.json (Claude Code), ~/.codex/config.toml (Codex) and',
      '      ~/.cursor/mcp.json (Cursor). Agents then auto-use it in any repo.',
      '',
      '  openvisio skeleton [path] [--budget=1500] [--task="..."]',
      '      Print the ranked, token-budgeted repo skeleton to stdout.',
      '      --task personalizes the ranking toward a task description.',
      '',
  '  openvisio export [path] [--out=.openvisio/graph.json]',
  '      Emit the deterministic graph as .openvisio/graph.json (or --stdout to',
  '      pipe the JSON elsewhere). Powers the visualization, no LLM.',
  '',
  '  openvisio index [path] [--out=.openvisio/graph.json]',
      '      Build the graph and write it where the viewer reads it (default:',
      '      <repo>/.openvisio/graph.json). Prints a one-line summary, not the JSON.',
      '',
      '  openvisio transport [path] [--server=https://openvisio.io] [--no-open]',
      '      Index the repo LOCALLY, then ship just the graph JSON to the web',
      '      server and open the rendered graph + narrator in your browser. Your',
      '      source never leaves your machine — only the computed graph is sent.',
      '      Override the destination with --server or OPENVISIO_SERVER.',
      '',
      '  openvisio view [path] [--port=7077] [--no-open]',
      '      Index a local repo and open the bundled graph viewer in your browser.',
      '      A self-contained UI (no install) that draws the same graph the MCP',
      '      serves; the path box re-indexes any other local repo. Doubles as the',
      '      spotlight hub: run `openvisio mcp . --spotlight` and the agent\'s tool',
      '      calls pulse the map live. --no-open just prints the URL. Until Ctrl-C.',
      '',
      '  openvisio spotlight [path] [--port=7077]',
      '      Start the localhost server an open viewer talks to: a live highlight',
      '      stream (SSE), the viewer→agent request queue, and on-demand indexing',
      '      (GET /api/graph?path=<repo>). Runs until Ctrl-C.',
      '',
      '  openvisio mcp [path] [--watch] [--spotlight] [--port=7077] [--cache-dir=<path>]',
      '      Serve the graph to Claude Code / Codex over MCP (stdio).',
      '      Tools: resolve_context, get_repo_skeleton, find_symbol,',
      '             get_neighborhood, get_dependents, get_hotspots.',
      '      --watch re-indexes changed files incrementally so the graph stays',
      '      fresh mid-session. --spotlight starts a local SSE server so an open',
      '      OpenVisio viewer highlights the files/edges the agent queries live.',
      '      --cache-dir persists parses to skip re-parsing on restart (default: .openvisio/cache).',
      '',
      '  openvisio agent [path] [--port=7077] [--cache-dir=<path>]',
      '      Hands-free answerer: runs the spotlight server AND auto-answers the',
      '      questions a viewer asks by running headless Claude (claude -p,',
      '      read-only) and streaming the reply back. This is what the viewer\'s',
      '      "spin agent" button launches.',
      '',
    ].join('\n'),
  )
}

async function runSkeleton(args: ParsedArgs): Promise<number> {
  const root = args.positional[0] ?? process.cwd()
  const budgetRaw = args.flags.get('budget')
  const budgetTokens = budgetRaw ? Number(budgetRaw) : 1500
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) {
    process.stderr.write(`Invalid --budget: ${budgetRaw}\n`)
    return 2
  }
  const task = args.flags.get('task')

  const started = process.hrtime.bigint()
  const graph = await buildGraph(root)
  const ranking = task ? rankForTask(graph, { taskText: task }) : undefined
  const skeleton = buildSkeleton(graph, { budgetTokens, ranking })
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

  process.stdout.write(skeleton.text + '\n')
  process.stderr.write(
    `\nopenvisio: indexed ${graph.files.length} files, ${graph.symbols.length} symbols, ` +
      `${graph.edges.length} edges in ${elapsedMs.toFixed(0)}ms at ${path.resolve(root)}\n`,
  )
  return 0
}

async function runExport(args: ParsedArgs): Promise<number> {
  const root = args.positional[0] ?? process.cwd()
  const started = process.hrtime.bigint()

  console.error('[cli] buildGraph start')
  process.stderr.write('openvisio: scanning filesystem...\n')
  const graph = await buildGraph(root)
  const scannedMs = Number(process.hrtime.bigint() - started) / 1e6
  console.error(`[cli] buildGraph done: ${graph.files.length} files, ${graph.symbols.length} symbols, ${graph.edges.length} edges`)
  process.stderr.write(
    `openvisio: scanned ${graph.files.length} files, ${graph.symbols.length} symbols, ` +
      `${graph.edges.length} edges in ${scannedMs.toFixed(0)}ms\n`,
  )

  console.error('[cli] toExportPayload start')
  process.stderr.write('openvisio: building export payload...\n')
  const payload = toExportPayload(graph, Date.now())
  console.error('[cli] toExportPayload done')

  process.stderr.write('openvisio: serializing JSON...\n')
  console.error('[cli] JSON.stringify start')
  const serializedMs = Number(process.hrtime.bigint() - started) / 1e6

  const json = JSON.stringify(payload)
  console.error('[cli] JSON.stringify done')
  const jsonSize = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1)

  if (args.flags.has('stdout')) {
    process.stderr.write(
      `openvisio export: ${graph.files.length} files, ${graph.symbols.length} symbols, ` +
        `${graph.edges.length} edges — ${jsonSize} MB JSON in ${serializedMs.toFixed(0)}ms — writing to stdout\n`,
    )
    process.stderr.write('openvisio: begins...\n')
    process.stdout.write(json + '\n')
    process.stderr.write('openvisio: done\n')
  } else {
    const outRaw = args.flags.get('out')
    const outFile = outRaw && outRaw !== 'true' ? outRaw : path.join(root, '.openvisio', 'graph.json')
    console.error(`[cli] writing ${jsonSize} MB to ${outFile}`)
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, json)
    if (!outRaw || outRaw === 'true') ensureGitIgnore(root)
    console.error('[cli] write done')
    process.stderr.write(
      `openvisio export: ${graph.files.length} files, ${graph.symbols.length} symbols, ` +
        `${graph.edges.length} edges — ${jsonSize} MB JSON in ${serializedMs.toFixed(0)}ms → ${outFile}\n`,
    )
  }
  console.error('[cli] runExport done, returning 0')
  return 0
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  switch (args.command) {
    // Bare `openvisio` in a project = set it up. The explicit `init` form
    // allows a path argument: `openvisio init ../other-repo`.
    case undefined:
      if (args.flags.has('help')) {
        printUsage()
        return 0
      }
      if (args.flags.has('global')) return runGlobalInit()
      return runInit({ rootPath: process.cwd(), cursor: args.flags.has('cursor') })
    case 'init':
      if (args.flags.has('global')) return runGlobalInit()
      return runInit({ rootPath: args.positional[0] ?? process.cwd(), cursor: args.flags.has('cursor') })
    case 'skeleton':
      return runSkeleton(args)
    case 'export':
      return runExport(args)
    case 'mcp': {
      const root = args.positional[0] ?? process.cwd()
      const watch = args.flags.has('watch')
      const spotlight = args.flags.has('spotlight')
      const portRaw = args.flags.get('port')
      const port = portRaw ? Number(portRaw) : undefined
      if (portRaw && (!Number.isInteger(port) || port! <= 0 || port! > 65535)) {
        process.stderr.write(`Invalid --port: ${portRaw}\n`)
        return 2
      }
      const cacheRaw = args.flags.get('cache-dir')
      const cacheDir = cacheRaw ?? path.join(root, '.openvisio', 'cache')
      await serveMcp({ rootPath: root, watch, spotlight, port, cacheDir })
      return 0
    }
    case 'agent': {
      const root = args.positional[0] ?? process.cwd()
      const portRaw = args.flags.get('port')
      const port = portRaw ? Number(portRaw) : undefined
      if (portRaw && (!Number.isInteger(port) || port! <= 0 || port! > 65535)) {
        process.stderr.write(`Invalid --port: ${portRaw}\n`)
        return 2
      }
      const cacheRaw = args.flags.get('cache-dir')
      const cacheDir = cacheRaw ?? path.join(root, '.openvisio', 'cache')
      await serveAgent({ rootPath: root, port, cacheDir })
      return 0
    }
    case 'view': {
      // Index a repo and host the bundled, dependency-free graph viewer. Defaults
      // to the spotlight port (7077) so the viewer doubles as the live-highlight
      // hub: an `openvisio mcp --spotlight` session attaches and pulses the map.
      const root = args.positional[0] ?? process.cwd()
      const portRaw = args.flags.get('port')
      const port = portRaw ? Number(portRaw) : 7077
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        process.stderr.write(`Invalid --port: ${portRaw}\n`)
        return 2
      }
      await serveViewer({ rootPath: root, port, open: !args.flags.has('no-open') })
      return 0
    }
    case 'spotlight': {
      // Standalone localhost server: SSE highlight stream + viewer↔agent request
      // queue + on-demand repo indexing. The viewer connects here; agents push
      // highlights over the same port via `openvisio mcp . --spotlight`.
      const root = args.positional[0] ?? process.cwd()
      const portRaw = args.flags.get('port')
      const port = portRaw ? Number(portRaw) : 7077
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        process.stderr.write(`Invalid --port: ${portRaw}\n`)
        return 2
      }
      const onIndex = async (repoPath: string) => toExportPayload(await buildGraph(repoPath), Date.now())
      let server: Awaited<ReturnType<typeof startSpotlightServer>>
      try {
        server = await startSpotlightServer(port, 'mcp', onIndex)
      } catch (err) {
        // Already serving here? Then a hub is up — nothing to do, exit clean.
        if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
          process.stderr.write(
            `openvisio spotlight: 127.0.0.1:${port} is already in use — ` +
              `if that's another openvisio spotlight, it's already serving; otherwise pass --port=<n>.\n`,
          )
          return 0
        }
        throw err
      }
      const base = `http://127.0.0.1:${server.port}`
      process.stderr.write(`openvisio spotlight: live on ${base}\n`)
      process.stderr.write(`  · highlight stream   GET  ${base}/api/spotlight\n`)
      process.stderr.write(`  · index a repo       GET  ${base}/api/graph?path=${encodeURIComponent(path.resolve(root))}\n`)
      process.stderr.write(`  · viewer → agent     POST ${base}/api/request\n`)
      process.stderr.write('  Ctrl-C to stop.\n')
      const stop = () => {
        server.close()
        process.exit(0)
      }
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      await new Promise<void>(() => {}) // run until killed
      return 0
    }
    case 'index': {
      // Build the graph and write it where the viewer reads it (.openvisio/
      // graph.json by default). Same deterministic engine the MCP serves.
      const root = args.positional[0] ?? process.cwd()
      const outRaw = args.flags.get('out')
      const out = outRaw && outRaw !== 'true' ? outRaw : path.join(root, '.openvisio', 'graph.json')
      const started = process.hrtime.bigint()
      const graph = await buildGraph(root)
      const payload = toExportPayload(graph, Date.now())
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, JSON.stringify(payload))
      if (!outRaw || outRaw === 'true') ensureGitIgnore(root)
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      process.stderr.write(
        `openvisio index: ${graph.files.length} files · ${graph.symbols.length.toLocaleString('en-US')} symbols · ` +
          `${graph.edges.length.toLocaleString('en-US')} edges in ${(ms / 1000).toFixed(1)}s → ${out}\n`,
      )
      return 0
    }
    case 'transport': {
      // Index locally, then ship the graph JSON to a web server that renders it.
      const root = args.positional[0] ?? process.cwd()
      const serverRaw = args.flags.get('server')
      const server = serverRaw && serverRaw !== 'true' ? serverRaw : process.env.OPENVISIO_SERVER || 'https://openvisio.io'
      const outRaw = args.flags.get('out')
      const out = outRaw && outRaw !== 'true' ? outRaw : undefined
      return runTransport({ rootPath: root, server, out, open: !args.flags.has('no-open') })
    }
    case 'help':
    case '--help':
      printUsage()
      return 0
    default:
      process.stderr.write(`Unknown command: ${args.command}\n\n`)
      printUsage()
      return 2
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    process.stderr.write(`openvisio: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exitCode = 1
  },
)
