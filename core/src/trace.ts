// Call-chain tracing — the "who calls this / what does this call" tool. The
// build step already extracts CALL edges (CodeEdge.kind === 'calls', symbol →
// symbol), but `adjacency` indexes IMPORT edges only, so no tool has ever walked
// them. Agents were left to grep for callers and read every hit whole. This
// traverses the call edges the graph already stores: BFS out from a symbol along
// callers (inbound) or callees (outbound), ranked by containing-file centrality,
// rendered as an indented tree with exact `path:line` anchors, token-budgeted.
// Deterministic, no LLM.

import { TokenBudget } from './budget.js'
import { computeCentrality, type Centrality } from './rank.js'
import type { ViewResult } from './skeleton.js'
import type { CodeEdge, CodeGraph, CodeSymbol } from './types.js'

export type TraceDirection = 'callers' | 'callees' | 'both'

export interface TraceCallsOptions {
  /** Symbol to trace from (exact name; the highest-centrality match wins ties). */
  symbolName: string
  /** callers = who calls it (inbound), callees = what it calls (outbound). Default callers. */
  direction?: TraceDirection
  /** How many call hops to follow (default 3, max 6). */
  depth?: number
  /** Token ceiling for the whole tree (default 1200). */
  budgetTokens?: number
  /** Reuse a precomputed centrality (else computed on the fly). */
  centrality?: Centrality
}

/** Symbol-id → in/out CALL edges (built on demand; the graph only indexes imports). */
interface CallIndex {
  byId: Map<number, CodeSymbol>
  adj: Map<number, { in: CodeEdge[]; out: CodeEdge[] }>
}

function buildCallIndex(graph: CodeGraph): CallIndex {
  const byId = new Map<number, CodeSymbol>()
  for (const s of graph.symbols) byId.set(s.id, s)
  const adj = new Map<number, { in: CodeEdge[]; out: CodeEdge[] }>()
  const get = (id: number) => {
    let e = adj.get(id)
    if (!e) {
      e = { in: [], out: [] }
      adj.set(id, e)
    }
    return e
  }
  for (const e of graph.edges) {
    if (e.kind !== 'calls') continue
    get(e.sourceId).out.push(e)
    get(e.targetId).in.push(e)
  }
  return { byId, adj }
}

/** `name  @path:line` for a symbol, with the file's language for orientation. */
function symbolLabel(graph: CodeGraph, sym: CodeSymbol): string {
  const file = graph.filesById.get(sym.fileId)
  const path = file?.path ?? '?'
  return `${sym.name}  @${path}:${sym.startLine}`
}

/**
 * Render one direction of the call tree from `rootId`. Children are ordered by
 * containing-file centrality (then path/line) so the load-bearing chain comes
 * first. A visited set breaks recursion cycles; budget stops growth cleanly.
 */
function renderTree(
  graph: CodeGraph,
  index: CallIndex,
  rootId: number,
  dir: 'in' | 'out',
  depth: number,
  budget: TokenBudget,
  centrality: Centrality,
): { lines: string[]; fileIds: Set<number>; edgeCount: number } {
  const arrow = dir === 'in' ? '←' : '→'
  const lines: string[] = []
  const fileIds = new Set<number>()
  const visited = new Set<number>([rootId])
  let edgeCount = 0
  let truncated = false

  const walk = (id: number, level: number): void => {
    if (level > depth || truncated) return
    const edges = index.adj.get(id)?.[dir] ?? []
    // Resolve neighbors, rank by centrality, stable tiebreak on path:line.
    const neighbors = edges
      .map((e) => {
        const neighborId = dir === 'in' ? e.sourceId : e.targetId
        const sym = index.byId.get(neighborId)
        return sym ? { sym, weight: e.weight } : null
      })
      .filter((x): x is { sym: CodeSymbol; weight: number } => x != null)
      .sort((a, b) => {
        const sa = centrality.scoreByFile.get(a.sym.fileId) ?? 0
        const sb = centrality.scoreByFile.get(b.sym.fileId) ?? 0
        if (sb !== sa) return sb - sa
        const pa = graph.filesById.get(a.sym.fileId)?.path ?? ''
        const pb = graph.filesById.get(b.sym.fileId)?.path ?? ''
        if (pa !== pb) return pa.localeCompare(pb)
        return a.sym.startLine - b.sym.startLine
      })

    for (const { sym, weight } of neighbors) {
      const indent = '  '.repeat(level)
      const cycle = visited.has(sym.id)
      const w = weight > 1 ? `  (×${weight})` : ''
      const mark = cycle ? '  ↺ (cycle)' : ''
      const row = `\n${indent}${arrow} ${symbolLabel(graph, sym)}${w}${mark}`
      if (!budget.tryAdd(row)) {
        truncated = true
        lines.push(`\n${indent}… trace truncated (budget reached)`)
        return
      }
      lines.push(row)
      fileIds.add(sym.fileId)
      edgeCount++
      if (!cycle) {
        visited.add(sym.id)
        walk(sym.id, level + 1)
      }
    }
  }

  walk(rootId, 1)
  return { lines, fileIds, edgeCount }
}

/**
 * Trace the call graph from a named symbol. Returns a ranked, anchored,
 * token-budgeted tree — the replacement for grepping for callers. When several
 * symbols share the name, the most import-central one is traced and the others
 * are noted so the agent can disambiguate.
 */
export function traceCalls(graph: CodeGraph, opts: TraceCallsOptions): ViewResult {
  if (!opts.symbolName) return { text: 'Provide a `symbol_name` to trace.', fileIds: [] }
  const centrality = opts.centrality ?? computeCentrality(graph)
  const depth = Math.max(1, Math.min(6, opts.depth ?? 3))
  const direction = opts.direction ?? 'callers'

  const matches = graph.symbols
    .filter((s) => s.name === opts.symbolName)
    .sort((a, b) => {
      const sa = centrality.scoreByFile.get(a.fileId) ?? 0
      const sb = centrality.scoreByFile.get(b.fileId) ?? 0
      if (sb !== sa) return sb - sa
      const pa = graph.filesById.get(a.fileId)?.path ?? ''
      const pb = graph.filesById.get(b.fileId)?.path ?? ''
      return pa.localeCompare(pb)
    })

  if (matches.length === 0) {
    return {
      text:
        `No symbol named "${opts.symbolName}". ` +
        'Use find_symbol with a pattern to discover the exact name, or search_code for a text match.',
      fileIds: [],
    }
  }

  const index = buildCallIndex(graph)
  const root = matches[0]!
  const budget = new TokenBudget(opts.budgetTokens ?? 1200)

  const header =
    `# call trace: ${opts.symbolName} (${direction}, depth ${depth}) — ` +
    `root ${symbolLabel(graph, root)}` +
    (matches.length > 1 ? `  [+${matches.length - 1} more same-named — trace the anchor if this isn't it]` : '') +
    '\n'
  budget.add(header)

  const out: string[] = []
  const fileIds = new Set<number>([root.fileId])
  let totalEdges = 0

  const sections: Array<{ title: string; dir: 'in' | 'out' }> =
    direction === 'both'
      ? [
          { title: 'callers (who calls it)', dir: 'in' },
          { title: 'callees (what it calls)', dir: 'out' },
        ]
      : direction === 'callees'
        ? [{ title: 'callees (what it calls)', dir: 'out' }]
        : [{ title: 'callers (who calls it)', dir: 'in' }]

  for (const sec of sections) {
    const secHeader = `\n## ${sec.title}`
    if (!budget.tryAdd(secHeader)) break
    out.push(secHeader)
    const tree = renderTree(graph, index, root.id, sec.dir, depth, budget, centrality)
    for (const id of tree.fileIds) fileIds.add(id)
    totalEdges += tree.edgeCount
    if (tree.edgeCount === 0) {
      const none = `\n  (none — no ${sec.dir === 'in' ? 'callers' : 'callees'} in the call graph)`
      if (budget.tryAdd(none)) out.push(none)
    } else {
      out.push(...tree.lines)
    }
  }

  if (totalEdges === 0) {
    out.push(
      '\n\nNote: call edges are heuristic (resolved by name within a file or its imports). ' +
        'Dynamic/dispatched calls may be missed — fall back to search_code for a text sweep.',
    )
  }

  return { text: header + out.join(''), fileIds: [...fileIds] }
}
