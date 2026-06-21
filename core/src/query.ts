// Graph query helpers shared by the MCP tools. Thin, deterministic reads over
// the in-memory CodeGraph: symbol lookup, file-target resolution, and directed
// dependency traversal — each centrality-ranked so the most load-bearing result
// comes first and budgeted output keeps what matters.

import { computeCentrality, type Centrality } from './rank.js'
import type { CodeFile, CodeGraph, CodeSymbol } from './types.js'

/** A symbol paired with its file + the containing file's centrality score. */
export interface SymbolHit {
  symbol: CodeSymbol
  file: CodeFile
  score: number
}

export interface FindSymbolOptions {
  /** Exact name match (case-sensitive) takes priority over substring. */
  name?: string
  /** Case-insensitive substring/regex over the symbol name. */
  pattern?: string
  /** Cap on returned hits before budgeting (default 25). */
  limit?: number
  /** Reuse a precomputed centrality (else computed on the fly). */
  centrality?: Centrality
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

/**
 * Find symbols by exact name and/or pattern, ranked by containing-file
 * centrality (then exported-first, then path/line for stability). Exact-name
 * hits always sort above pattern-only hits.
 */
export function findSymbols(graph: CodeGraph, opts: FindSymbolOptions): SymbolHit[] {
  const centrality = opts.centrality ?? computeCentrality(graph)
  const limit = opts.limit ?? 25
  const re = opts.pattern ? safeRegex(opts.pattern) : null
  const wantName = opts.name

  const hits: (SymbolHit & { exact: boolean })[] = []
  for (const sym of graph.symbols) {
    const exact = wantName != null && sym.name === wantName
    const matches = exact || (re != null && re.test(sym.name))
    if (!matches) continue
    const file = graph.filesById.get(sym.fileId)
    if (!file) continue
    hits.push({ symbol: sym, file, score: centrality.scoreByFile.get(file.id) ?? 0, exact })
  }

  hits.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    if (a.symbol.exported !== b.symbol.exported) return a.symbol.exported ? -1 : 1
    if (a.file.path !== b.file.path) return a.file.path.localeCompare(b.file.path)
    return a.symbol.startLine - b.symbol.startLine
  })
  return hits.slice(0, limit).map(({ exact: _exact, ...h }) => h)
}

/**
 * Resolve a free-form target (a file path, path suffix, or a symbol name) to a
 * file id. Tries: exact path, unique path suffix, then the file of a uniquely
 * named symbol. Returns null if ambiguous or unknown.
 */
export function resolveFileTarget(graph: CodeGraph, target: string): number | null {
  const t = target.trim().replace(/^\.\//, '')
  // Exact repo-relative path.
  const exact = graph.fileIdByPath.get(t)
  if (exact != null) return exact
  // Unique path suffix (e.g. "api/client.ts").
  const suffixMatches = graph.files.filter((f) => f.path === t || f.path.endsWith('/' + t))
  if (suffixMatches.length === 1) return suffixMatches[0]!.id
  // A uniquely-named symbol → its file.
  const symMatches = graph.symbols.filter((s) => s.name === t)
  const fileIds = new Set(symMatches.map((s) => s.fileId))
  if (fileIds.size === 1) return [...fileIds][0]!
  return null
}

/** A directed dependency edge resolved to the neighbor file + its centrality. */
export interface DependencyHit {
  file: CodeFile
  weight: number
  score: number
}

function neighbors(
  graph: CodeGraph,
  fileId: number,
  direction: 'in' | 'out',
  centrality: Centrality,
): DependencyHit[] {
  const adj = graph.adjacency.get(fileId)
  if (!adj) return []
  const edges = direction === 'in' ? adj.in : adj.out
  const out: DependencyHit[] = []
  for (const e of edges) {
    const neighborId = direction === 'in' ? e.sourceId : e.targetId
    const file = graph.filesById.get(neighborId)
    if (!file) continue
    out.push({ file, weight: e.weight, score: centrality.scoreByFile.get(neighborId) ?? 0 })
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.weight !== a.weight) return b.weight - a.weight
    return a.file.path.localeCompare(b.file.path)
  })
  return out
}

/** Files that import `fileId` (impact set: "if I change this, what breaks"). */
export function dependentsOf(graph: CodeGraph, fileId: number, centrality?: Centrality): DependencyHit[] {
  return neighbors(graph, fileId, 'in', centrality ?? computeCentrality(graph))
}

/** Files that `fileId` imports (its requirements). */
export function dependenciesOf(graph: CodeGraph, fileId: number, centrality?: Centrality): DependencyHit[] {
  return neighbors(graph, fileId, 'out', centrality ?? computeCentrality(graph))
}
