// Browser tree-sitter loader (PoC). The SAME web-tree-sitter the Node engine
// uses — only the I/O differs: grammar wasm comes from a fetched URL instead of
// the filesystem (`Language.load` already takes bytes), and the runtime wasm is
// located by URL via `Parser.init({ locateFile })`. Grammars lazy-load per
// detected language, so a repo only pulls the few MB it needs.

import { Parser, Language, Query, type Node } from 'web-tree-sitter'

const WASM_BASE = '/wasm'
let initPromise: Promise<void> | null = null
const grammars = new Map<string, Language>()

/** Initialise the tree-sitter runtime once (idempotent). */
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: (file: string) => (file.endsWith('.wasm') ? `${WASM_BASE}/tree-sitter.wasm` : file),
      // Matches the Node engine: 30+ grammars + the query compiler overrun the
      // default 32 MB heap.
      INITIAL_MEMORY: 256 * 1024 * 1024,
    })
  }
  return initPromise
}

/** Fetch + load a grammar wasm by id (e.g. 'typescript'). Cached. */
export async function loadGrammar(id: string): Promise<void> {
  await ensureInit()
  if (grammars.has(id)) return
  const res = await fetch(`${WASM_BASE}/tree-sitter-${id}.wasm`)
  if (!res.ok) throw new Error(`grammar ${id} wasm fetch failed (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  grammars.set(id, await Language.load(bytes))
}

/** Parse source with a loaded grammar → syntax-tree root node. */
export function parse(id: string, source: string): Node {
  const lang = grammars.get(id)
  if (!lang) throw new Error(`grammar ${id} not loaded`)
  const parser = new Parser()
  parser.setLanguage(lang)
  const tree = parser.parse(source)
  if (!tree) throw new Error(`parse failed for grammar ${id}`)
  return tree.rootNode
}

/** Compile a tree-sitter query against a loaded grammar. */
export function compileQuery(id: string, source: string): Query {
  const lang = grammars.get(id)
  if (!lang) throw new Error(`grammar ${id} not loaded`)
  return new Query(lang, source)
}

export interface CompiledQueries {
  symbolQuery: Query
  importQuery: Query | null
  callQuery: Query | null
}
const queryCache = new Map<string, CompiledQueries>()

/** Compile + cache a grammar's queries (mirror of core's getOrCompileQueries). */
export function getQueries(id: string, config: { symbolQuery: string; importQuery: string | null; callQuery?: string }): CompiledQueries {
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
