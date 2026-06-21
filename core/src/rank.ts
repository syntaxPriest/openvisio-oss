// Centrality + relevance ranking over the import-edge graph. This is the asset
// that makes "rank, don't dump" possible: a file imported by 20 others is more
// valuable context than a private helper imported once. Deterministic — same
// graph → same scores → stable agent context (no churn between turns).
//
// We score files (not symbols): import edges are file-level, and a file's rank
// flows to its symbols. The skeleton/slice layers read these scores.

import type { CodeGraph } from './types.js'

const DAMPING = 0.85
const ITERATIONS = 40 // fixed count → deterministic; converges well before this.
// In task ranking, how strongly a direct lexical match outweighs PageRank. >1 so
// a file the task literally names beats a high-centrality non-match.
const MATCH_WEIGHT = 2

export interface Centrality {
  /** fileId → PageRank score, normalized so the max score is 1. */
  scoreByFile: Map<number, number>
}

/**
 * Personalized PageRank over `edges` (source imports target). Rank flows along
 * import direction: a file accrues rank from the files that import it, so
 * widely-imported "load-bearing" files rank highest.
 *
 * `personalization` optionally biases the random-teleport target distribution
 * toward task-relevant files (used by rankForTask). When omitted, teleport is
 * uniform, giving plain structural centrality.
 */
export function computeCentrality(
  graph: CodeGraph,
  personalization?: Map<number, number>,
): Centrality {
  const ids = graph.files.map((f) => f.id)
  const n = ids.length
  const scoreByFile = new Map<number, number>()
  if (n === 0) return { scoreByFile }
  console.error(`[rank] computing centrality for ${n} files`)

  // Outgoing adjacency with weights (rank flows from importer → imported).
  const outTo = new Map<number, { to: number; w: number }[]>()
  const outWeight = new Map<number, number>()
  for (const id of ids) {
    outTo.set(id, [])
    outWeight.set(id, 0)
  }
  for (const e of graph.edges) {
    // Centrality is over the file import graph. `calls` edges carry symbol ids,
    // not file ids, so they must be excluded or outTo.get() is undefined.
    if (e.kind !== 'import') continue
    outTo.get(e.sourceId)!.push({ to: e.targetId, w: e.weight })
    outWeight.set(e.sourceId, (outWeight.get(e.sourceId) ?? 0) + e.weight)
  }

  // Teleport distribution: personalized if provided (normalized), else uniform.
  const teleport = new Map<number, number>()
  let pSum = 0
  if (personalization) {
    for (const id of ids) pSum += personalization.get(id) ?? 0
  }
  for (const id of ids) {
    teleport.set(id, pSum > 0 ? (personalization!.get(id) ?? 0) / pSum : 1 / n)
  }

  // Initialize uniformly.
  let rank = new Map<number, number>()
  for (const id of ids) rank.set(id, 1 / n)

  for (let iter = 0; iter < ITERATIONS; iter++) {
    if (iter % 10 === 0) console.error(`[rank] PageRank iteration ${iter + 1}/${ITERATIONS}`)
    const next = new Map<number, number>()
    // Base mass from teleport (the (1-d) term).
    for (const id of ids) next.set(id, (1 - DAMPING) * teleport.get(id)!)
    // Dangling mass (files that import nothing) is redistributed via teleport.
    let dangling = 0
    for (const id of ids) {
      if ((outWeight.get(id) ?? 0) === 0) dangling += rank.get(id)!
    }
    for (const id of ids) {
      next.set(id, next.get(id)! + DAMPING * dangling * teleport.get(id)!)
    }
    // Flow rank along weighted out-edges.
    for (const id of ids) {
      const w = outWeight.get(id) ?? 0
      if (w === 0) continue
      const share = (DAMPING * rank.get(id)!) / w
      for (const { to, w: ew } of outTo.get(id)!) {
        next.set(to, next.get(to)! + share * ew)
      }
    }
    rank = next
  }

  // Normalize so the top file scores 1 (stable, easy thresholds downstream).
  let max = 0
  for (const v of rank.values()) if (v > max) max = v
  for (const id of ids) scoreByFile.set(id, max > 0 ? rank.get(id)! / max : 0)
  console.error(`[rank] done, max score: ${max}`)
  return { scoreByFile }
}

/** A file id paired with its relevance score, highest first. */
export interface RankedFile {
  fileId: number
  score: number
}

/** Sort all files by centrality, descending; ties broken by path for stability. */
export function rankByCentrality(graph: CodeGraph, centrality: Centrality): RankedFile[] {
  return [...graph.files]
    .map((f) => ({ fileId: f.id, score: centrality.scoreByFile.get(f.id) ?? 0 }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const pa = graph.filesById.get(a.fileId)!.path
      const pb = graph.filesById.get(b.fileId)!.path
      return pa.localeCompare(pb)
    })
}

/** Lowercase alphanumeric tokens (≥3 chars) from arbitrary text, for matching. */
function tokenize(text: string): string[] {
  const out: string[] = []
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    if (m[0].length >= 3) out.push(m[0])
  }
  return out
}

export interface RankForTaskOptions {
  /** Free-text task description; its tokens bias ranking toward matching files. */
  taskText?: string
  /** File ids to treat as a focus set; their neighborhood is up-weighted. */
  focusFileIds?: number[]
  /** Pre-computed plain centrality (avoids redundant PageRank when there's no personalization). */
  centrality?: Centrality
}

/**
 * Task-personalized ranking. Builds a personalization vector from files whose
 * path/symbol names match the task tokens (and any explicit focus files), then
 * runs personalized PageRank so structurally-central *and* task-relevant files
 * float to the top. This powers resolve_context.
 *
 * Falls back to plain centrality when there's nothing to personalize on, so the
 * output is always well-defined.
 */
export function rankForTask(graph: CodeGraph, opts: RankForTaskOptions = {}): RankedFile[] {
  const tokens = opts.taskText ? tokenize(opts.taskText) : []
  const focus = new Set(opts.focusFileIds ?? [])
  const hasSignal = tokens.length > 0 || focus.size > 0
  if (!hasSignal) {
    return rankByCentrality(graph, opts.centrality ?? computeCentrality(graph))
  }

  const tokenSet = new Set(tokens)
  const personalization = new Map<number, number>()
  for (const file of graph.files) {
    let weight = 0
    if (focus.has(file.id)) weight += 3
    for (const t of tokenize(file.path)) {
      if (tokenSet.has(t)) weight += 1
    }
    for (const sym of graph.symbolsByFile.get(file.id) ?? []) {
      for (const t of tokenize(sym.name)) {
        if (tokenSet.has(t)) weight += 2
      }
    }
    if (weight > 0) personalization.set(file.id, weight)
  }

  if (personalization.size === 0) {
    return rankByCentrality(graph, opts.centrality ?? computeCentrality(graph))
  }

  // Blend a normalized DIRECT lexical-match score with personalized PageRank.
  // Pure PPR still lets a high-fan-in hub (e.g. a shared types file) outrank the
  // files the task literally names — useless for resolve_context. Weighting the
  // direct match above PPR guarantees task-relevant files lead, while PPR breaks
  // ties (toward more central matches) and still admits structurally-important
  // neighbors below them.
  const centrality = computeCentrality(graph, personalization)
  let maxMatch = 0
  for (const v of personalization.values()) if (v > maxMatch) maxMatch = v

  const ranked: RankedFile[] = graph.files.map((f) => {
    const ppr = centrality.scoreByFile.get(f.id) ?? 0 // already normalized to max 1
    const match = maxMatch > 0 ? (personalization.get(f.id) ?? 0) / maxMatch : 0
    return { fileId: f.id, score: MATCH_WEIGHT * match + ppr }
  })
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return graph.filesById.get(a.fileId)!.path.localeCompare(graph.filesById.get(b.fileId)!.path)
  })
  return ranked
}
