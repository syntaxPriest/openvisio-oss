// Bound a file-level GraphResponse to a maximum node count before it is laid out
// and rendered. The file graph (React Flow) mounts one DOM node per file + edge,
// so an uncapped graph on a large repo blows up RAM. When over budget we keep the
// most import-connected files (the backbone), tie-broken by LOC, and drop the
// long tail — mirroring the node-budget approach in `lib/graph/atlas.ts`.

import type { GraphResponse } from '@/lib/api/types'

export interface CappedGraph {
  graph: GraphResponse
  truncated: boolean
  shownFiles: number
  totalFiles: number
}

export function capFileGraph(graph: GraphResponse, cap: number): CappedGraph {
  const totalFiles = graph.files.length
  if (totalFiles <= cap) {
    return { graph, truncated: false, shownFiles: totalFiles, totalFiles }
  }

  // Rank files by import-degree (how connected they are), tie-broken by size.
  const degree = new Map<number, number>()
  for (const e of graph.edges) {
    if (e.edge_kind === 'import' && e.source_kind === 'file' && e.target_kind === 'file') {
      degree.set(e.source_id, (degree.get(e.source_id) ?? 0) + 1)
      degree.set(e.target_id, (degree.get(e.target_id) ?? 0) + 1)
    }
  }
  const kept = [...graph.files]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || b.loc - a.loc)
    .slice(0, cap)
  const keepIds = new Set(kept.map((f) => f.id))

  // Symbol → owning file, so we can drop symbol-level edges whose file was cut.
  const fileOfSymbol = new Map<number, number>()
  for (const s of graph.symbols) fileOfSymbol.set(s.id, s.file_id)
  const symbolKept = (id: number) => {
    const fid = fileOfSymbol.get(id)
    return fid !== undefined && keepIds.has(fid)
  }
  const endpointKept = (id: number, kind: 'file' | 'symbol') =>
    kind === 'file' ? keepIds.has(id) : symbolKept(id)

  const graphOut: GraphResponse = {
    ...graph,
    files: kept,
    symbols: graph.symbols.filter((s) => keepIds.has(s.file_id)),
    edges: graph.edges.filter(
      (e) => endpointKept(e.source_id, e.source_kind) && endpointKept(e.target_id, e.target_kind),
    ),
    history: graph.history.filter((h) => keepIds.has(h.file_id)),
  }
  return { graph: graphOut, truncated: true, shownFiles: kept.length, totalFiles }
}
