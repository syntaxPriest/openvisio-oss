// BM25 symbol ranking — natural-language code discovery without a vector index.
// find_symbol's exact/regex modes only help when you already know the
// identifier. The expensive failure is the guess→miss→grep-again loop when you
// DON'T ("the function that updates the cloud client" → `updateCloudClient`).
// BM25 closes it: tokenize the query and the symbol corpus (name + signature +
// path) with camelCase/snake_case splitting, score by term frequency × rarity,
// and rank — so multi-word, order-independent, sub-identifier queries land on
// the right symbol in one call. Deterministic, dependency-free, no embeddings.

import { computeCentrality, type Centrality } from './rank.js'
import type { CodeFile, CodeGraph, CodeSymbol } from './types.js'

/** Split an identifier/phrase into lowercase word tokens: whitespace, punctuation,
 *  camelCase, and snake_case all break. `updateCloudClient` → update, cloud, client. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue
    // Split camelCase / PascalCase / digit boundaries.
    for (const piece of raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Za-z])([0-9])/g, '$1 $2').split(/\s+/)) {
      const t = piece.toLowerCase()
      if (t.length >= 2) out.push(t)
    }
  }
  return out
}

/** Structural priors mirroring search_graph: callable code ranks above types,
 *  types above bare consts. Applied as a small multiplicative boost. */
const KIND_BOOST: Record<CodeSymbol['kind'], number> = {
  function: 1.25,
  method: 1.2,
  class: 1.12,
  interface: 1.08,
  type: 1.05,
  const: 1.0,
}

export interface RankedSymbolHit {
  symbol: CodeSymbol
  file: CodeFile
  score: number
}

export interface Bm25Options {
  limit?: number
  centrality?: Centrality
  /** BM25 term-frequency saturation (default 1.5). */
  k1?: number
  /** BM25 length normalization (default 0.75). */
  b?: number
}

/**
 * Rank symbols against a natural-language query with BM25 over their
 * name+signature+path tokens, then apply light structural (kind) and centrality
 * boosts so the load-bearing, callable hit wins ties. Returns [] when the query
 * has no usable terms.
 */
export function rankSymbols(graph: CodeGraph, query: string, opts: Bm25Options = {}): RankedSymbolHit[] {
  const qTerms = [...new Set(tokenize(query))]
  if (qTerms.length === 0) return []
  const centrality = opts.centrality ?? computeCentrality(graph)
  const k1 = opts.k1 ?? 1.5
  const b = opts.b ?? 0.75
  const limit = opts.limit ?? 25

  // Build the per-symbol token documents once.
  type Doc = { sym: CodeSymbol; file: CodeFile; tf: Map<string, number>; len: number }
  const docs: Doc[] = []
  const df = new Map<string, number>()
  let totalLen = 0
  for (const sym of graph.symbols) {
    const file = graph.filesById.get(sym.fileId)
    if (!file) continue
    const tokens = tokenize(`${sym.name} ${sym.signature} ${file.path}`)
    if (tokens.length === 0) continue
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    // Document frequency counts each query term at most once per doc.
    for (const t of qTerms) if (tf.has(t)) df.set(t, (df.get(t) ?? 0) + 1)
    docs.push({ sym, file, tf, len: tokens.length })
    totalLen += tokens.length
  }
  if (docs.length === 0) return []
  const avgLen = totalLen / docs.length
  const N = docs.length

  // Precompute idf per query term (BM25 idf, floored at 0 so ubiquitous terms
  // don't push scores negative).
  const idf = new Map<string, number>()
  for (const t of qTerms) {
    const n = df.get(t) ?? 0
    idf.set(t, Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5))))
  }

  const hits: RankedSymbolHit[] = []
  for (const d of docs) {
    let score = 0
    let matched = 0
    for (const t of qTerms) {
      const f = d.tf.get(t)
      if (!f) continue
      matched++
      const w = idf.get(t) ?? 0
      score += w * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen)))
    }
    if (matched === 0) continue
    // Reward covering more distinct query terms; apply kind + centrality boosts.
    const coverage = matched / qTerms.length
    const cen = 1 + (centrality.scoreByFile.get(d.file.id) ?? 0)
    score *= KIND_BOOST[d.sym.kind] * (0.5 + 0.5 * coverage) * cen
    hits.push({ symbol: d.sym, file: d.file, score })
  }

  hits.sort((a, b2) => {
    if (b2.score !== a.score) return b2.score - a.score
    if (a.symbol.exported !== b2.symbol.exported) return a.symbol.exported ? -1 : 1
    if (a.file.path !== b2.file.path) return a.file.path.localeCompare(b2.file.path)
    return a.symbol.startLine - b2.symbol.startLine
  })
  return hits.slice(0, limit)
}
