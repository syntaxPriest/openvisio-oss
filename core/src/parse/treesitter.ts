// web-tree-sitter loader. Grammars are bulk-loaded via `loadGrammars()` before
// any parsing begins — this avoids Emscripten WASM instantiation races from
// concurrent `Language.load()` calls. After pre-load, `parseSource()` creates a
// fresh `Parser` per call (safe — grammars are immutable after load) and never
// touches the WASM loader again.

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Language, Parser, Query } from 'web-tree-sitter'
import { grammarIdFromPath } from './extensions.js'

const require = createRequire(import.meta.url)

// The core package root, used only to probe for an optional bundled `wasm/`
// dir. Resolved relative to this module in the monorepo source layout — but
// when @openvisio/core is BUNDLED into the single-file `openvisio` CLI, this
// path points outside the installed package and throws. That's fine: there's
// no bundled wasm in the published package, so a null CORE_DIR simply skips the
// bundled-wasm check and falls back to the tree-sitter-wasms dependency.
const CORE_DIR: string | null = (() => {
  try {
    return path.dirname(require.resolve('../../package.json'))
  } catch {
    return null
  }
})()

export type GrammarId =
  | 'typescript' | 'tsx' | 'javascript' | 'python' | 'go' | 'rust' | 'java'
  | 'c' | 'cpp' | 'c_sharp' | 'kotlin' | 'ruby' | 'php' | 'swift' | 'scala'
  | 'dart' | 'zig' | 'lua' | 'r' | 'elixir' | 'elm' | 'ocaml' | 'rescript'
  | 'solidity' | 'tlaplus' | 'objc' | 'bash' | 'vue' | 'html' | 'css'
  | 'json' | 'yaml' | 'toml' | 'embedded_template' | 'systemrdl' | 'ql' | 'elisp'

const WASM_FILE: Record<GrammarId, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  c_sharp: 'tree-sitter-c_sharp.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  php: 'tree-sitter-php.wasm',
  swift: 'tree-sitter-swift.wasm',
  scala: 'tree-sitter-scala.wasm',
  dart: 'tree-sitter-dart.wasm',
  zig: 'tree-sitter-zig.wasm',
  lua: 'tree-sitter-lua.wasm',
  r: 'tree-sitter-r.wasm',
  elixir: 'tree-sitter-elixir.wasm',
  elm: 'tree-sitter-elm.wasm',
  ocaml: 'tree-sitter-ocaml.wasm',
  rescript: 'tree-sitter-rescript.wasm',
  solidity: 'tree-sitter-solidity.wasm',
  tlaplus: 'tree-sitter-tlaplus.wasm',
  objc: 'tree-sitter-objc.wasm',
  bash: 'tree-sitter-bash.wasm',
  vue: 'tree-sitter-vue.wasm',
  html: 'tree-sitter-html.wasm',
  css: 'tree-sitter-css.wasm',
  json: 'tree-sitter-json.wasm',
  yaml: 'tree-sitter-yaml.wasm',
  toml: 'tree-sitter-toml.wasm',
  embedded_template: 'tree-sitter-embedded_template.wasm',
  systemrdl: 'tree-sitter-systemrdl.wasm',
  ql: 'tree-sitter-ql.wasm',
  elisp: 'tree-sitter-elisp.wasm',
}

// Grammars to skip loading/parsing. Files in these languages still appear as
// file nodes (the scanner labels language independently), just without
// symbol/import parsing. `tree-sitter-swift.wasm` is large enough to crash V8's
// background WASM compiler on some Node builds (a hard, uncatchable process
// abort — see DefaultJobWorker frames in the crash), so it's disabled by
// default. Override via env:
//   OPENVISIO_DISABLE_GRAMMARS=swift,scala   — add more to the denylist
//   OPENVISIO_ENABLE_GRAMMARS=swift          — force one back on
const DEFAULT_DISABLED: GrammarId[] = ['swift']

function computeDisabled(): Set<GrammarId> {
  const set = new Set<GrammarId>(DEFAULT_DISABLED)
  const add = process.env.OPENVISIO_DISABLE_GRAMMARS
  if (add) for (const g of add.split(',').map((s) => s.trim()).filter(Boolean)) set.add(g as GrammarId)
  const remove = process.env.OPENVISIO_ENABLE_GRAMMARS
  if (remove) for (const g of remove.split(',').map((s) => s.trim()).filter(Boolean)) set.delete(g as GrammarId)
  return set
}
const DISABLED_GRAMMARS = computeDisabled()

let initialized = false
const grammarCache = new Map<GrammarId, Language>()

function wasmsDir(): string {
  if (CORE_DIR) {
    const bundled = path.join(CORE_DIR, 'wasm')
    if (fs.existsSync(bundled)) return bundled
  }
  const pkgJson = require.resolve('tree-sitter-wasms/package.json')
  return path.join(path.dirname(pkgJson), 'out')
}

function runtimeWasmPath(): string {
  return require.resolve('web-tree-sitter/tree-sitter.wasm')
}

async function ensureInit(): Promise<void> {
  if (initialized) return
  const runtime = runtimeWasmPath()
  await Parser.init({
    locateFile: (file: string) => (file.endsWith('.wasm') ? runtime : file),
    // Bump initial WASM heap from the 32 MB default — the combined grammar
    // binary + query-compiler footprint for 30+ loaded grammars exceeds
    // the tiny default, causing ts_malloc_default / ts_query_new to OOM.
    INITIAL_MEMORY: 256 * 1024 * 1024,
  })
  initialized = true
}

/** Map a file's relative path → the grammar that should parse it. Disabled
 *  grammars resolve to null so their files are treated as file-only nodes. */
export function grammarForFile(relPath: string): GrammarId | null {
  const id = grammarIdFromPath(relPath)
  if (id && DISABLED_GRAMMARS.has(id)) return null
  return id
}

/** Pre-load a set of grammars into memory. Must be called before any parseSource
 *  calls. Disabled grammars are skipped; a grammar that fails to load is skipped
 *  with a warning rather than aborting the whole index. */
export async function loadGrammars(ids: GrammarId[]): Promise<void> {
  await ensureInit()
  for (const id of ids) {
    if (DISABLED_GRAMMARS.has(id) || grammarCache.has(id)) continue
    const file = path.join(wasmsDir(), WASM_FILE[id])
    try {
      const bytes = new Uint8Array(fs.readFileSync(file))
      const lang = await Language.load(bytes)
      grammarCache.set(id, lang)
    } catch (err) {
      console.error(`[treesitter] skipping grammar ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/** Parse source with a pre-loaded grammar; returns the syntax tree root node.
 *  When `timeoutMs` is > 0, the synchronous parse is wrapped in a promise race so a
 *  pathological file (e.g. a giant generated one) doesn't hang the whole batch. */
export async function parseSource(id: GrammarId, source: string, timeoutMs?: number) {
  const lang = grammarCache.get(id)
  if (!lang) throw new Error(`Grammar ${id} not loaded — call loadGrammars() first`)
  const parser = new Parser()
  parser.setLanguage(lang)

  const doParse = () => {
    const tree = parser.parse(source)
    if (!tree) throw new Error(`tree-sitter failed to parse with grammar ${id}`)
    return tree.rootNode
  }

  if (timeoutMs && timeoutMs > 0) {
    return Promise.race([
      Promise.resolve().then(doParse),
      new Promise<never>((_, reject) => setTimeout(() => {
        console.error(`[treesitter] parse timeout after ${timeoutMs}ms for ${id}`)
        reject(new Error(`parse timeout after ${timeoutMs}ms for ${id}`))
      }, timeoutMs)),
    ])
  }

  return doParse()
}

/** Compile a tree-sitter query against a pre-loaded grammar. */
export function compileQuery(id: GrammarId, source: string): Query {
  const lang = grammarCache.get(id)
  if (!lang) throw new Error(`Grammar ${id} not loaded — call loadGrammars() first`)
  return new Query(lang, source)
}

/** Pre-compiled queries for a grammar, keyed by query source. */
export interface CompiledQueries {
  symbolQuery: Query
  importQuery: Query | null
  callQuery: Query | null
}

const queryCache = new Map<string, CompiledQueries>()

export function getOrCompileQueries(id: GrammarId, config: { symbolQuery: string; importQuery: string | null; callQuery?: string }): CompiledQueries {
  const key = `${id}::${config.symbolQuery}::${config.importQuery}::${config.callQuery ?? ''}`
  let cached = queryCache.get(key)
  if (!cached) {
    cached = {
      symbolQuery: compileQuery(id, config.symbolQuery),
      importQuery: config.importQuery ? compileQuery(id, config.importQuery) : null,
      callQuery: config.callQuery ? compileQuery(id, config.callQuery) : null,
    }
    queryCache.set(key, cached)
  }
  return cached
}
