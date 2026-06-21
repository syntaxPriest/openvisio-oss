// Neighborhood slicing — the local subgraph a senior engineer would point a new
// hire at: a center file plus its dependents and dependencies out to `depth`,
// each with its public surface, ranked by centrality and token-budgeted. Built
// over the same import edges the viewer and the other tools share.

import { TokenBudget } from './budget.js'
import { computeCentrality, type Centrality } from './rank.js'
import { formatSymbol, type ViewResult } from './skeleton.js'
import type { CodeGraph } from './types.js'

export interface NeighborhoodOptions {
  /** How many import hops out from the center (both directions). Default 1. */
  depth?: number
  /** Token ceiling for the whole view (default 1200). */
  budgetTokens?: number
  /** Max signatures listed per file (default 8). */
  maxSymbolsPerFile?: number
  /** Reuse a precomputed centrality. */
  centrality?: Centrality
}

interface Ringed {
  fileId: number
  /** BFS distance from the center (0 = center). */
  ring: number
  /** Edge direction that reached it relative to the center. */
  relation: 'center' | 'dependency' | 'dependent' | 'mixed'
}

/** BFS over edges in both directions, recording ring distance + relation. */
function gatherNeighborhood(graph: CodeGraph, centerId: number, depth: number): Ringed[] {
  const seen = new Map<number, Ringed>()
  seen.set(centerId, { fileId: centerId, ring: 0, relation: 'center' })
  let frontier = [centerId]
  for (let ring = 1; ring <= depth; ring++) {
    const next: number[] = []
    for (const id of frontier) {
      const adj = graph.adjacency.get(id)
      if (!adj) continue
      for (const e of adj.out) {
        const neighbor = e.targetId
        const existing = seen.get(neighbor)
        if (existing) {
          if (existing.ring === ring && existing.relation === 'dependent') {
            existing.relation = 'mixed'
          }
          continue
        }
        seen.set(neighbor, { fileId: neighbor, ring, relation: 'dependency' })
        next.push(neighbor)
      }
      for (const e of adj.in) {
        const neighbor = e.sourceId
        const existing = seen.get(neighbor)
        if (existing) {
          if (existing.ring === ring && existing.relation === 'dependency') {
            existing.relation = 'mixed'
          }
          continue
        }
        seen.set(neighbor, { fileId: neighbor, ring, relation: 'dependent' })
        next.push(neighbor)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return [...seen.values()]
}

/**
 * Render the neighborhood of `centerId`. The center comes first (full public
 * surface), then neighbors ordered by ring, then centrality. Token-budgeted;
 * never emits a misleading half-file. Returns the text + every file id shown.
 */
export function buildNeighborhood(
  graph: CodeGraph,
  centerId: number,
  opts: NeighborhoodOptions = {},
): ViewResult {
  const depth = opts.depth ?? 1
  const maxSyms = opts.maxSymbolsPerFile ?? 8
  const centrality = opts.centrality ?? computeCentrality(graph)
  const budget = new TokenBudget(opts.budgetTokens ?? 1200)

  const center = graph.filesById.get(centerId)
  if (!center) return { text: `Unknown file id ${centerId}.`, fileIds: [] }

  const ringed = gatherNeighborhood(graph, centerId, depth).sort((a, b) => {
    if (a.ring !== b.ring) return a.ring - b.ring
    const sa = centrality.scoreByFile.get(a.fileId) ?? 0
    const sb = centrality.scoreByFile.get(b.fileId) ?? 0
    if (sb !== sa) return sb - sa
    return graph.filesById.get(a.fileId)!.path.localeCompare(graph.filesById.get(b.fileId)!.path)
  })

  const header = `# neighborhood of ${center.path} (depth ${depth}, ${ringed.length} files)\n`
  budget.add(header)
  const lines: string[] = []
  const fileIds: number[] = []

  for (const r of ringed) {
    const file = graph.filesById.get(r.fileId)!
    const syms = [...(graph.symbolsByFile.get(r.fileId) ?? [])].sort((a, b) => {
      if (a.exported !== b.exported) return a.exported ? -1 : 1
      return a.startLine - b.startLine
    })
    const tag =
      r.relation === 'center' ? 'CENTER' : `${r.relation}${r.ring > 1 ? ` ·${r.ring}` : ''}`
    const fileHeader = `\n[${tag}] ${file.path}  (${file.language}, ${file.loc} loc)`
    const firstLine = syms[0] ? '\n' + formatSymbol(syms[0], file.path) : ''
    if (budget.wouldExceed(fileHeader + firstLine)) {
      lines.push(`\n[${tag}] ${file.path}  @${file.path}:1  (budget reached)`)
      break
    }
    budget.add(fileHeader)
    lines.push(fileHeader)
    let shown = 0
    for (const sym of syms) {
      if (shown >= maxSyms) break
      const line = formatSymbol(sym, file.path)
      if (!budget.tryAdd('\n' + line)) break
      lines.push(line)
      shown++
    }
    if (syms.length === 0) {
      const note = `  (no public symbols — @${file.path}:1)`
      if (budget.tryAdd('\n' + note)) lines.push(note)
    } else if (shown < syms.length) {
      const more = `  … ${syms.length - shown} more in ${file.path}`
      if (budget.tryAdd('\n' + more)) lines.push(more)
    }
    fileIds.push(r.fileId)
  }

  return { text: header + lines.join('\n'), fileIds }
}
