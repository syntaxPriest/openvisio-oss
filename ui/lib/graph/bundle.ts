// Export / import a graph as a portable file. The graph is fully self-contained
// (files, symbols, edges, history, layout + the folder architecture graph), so a
// bundle can be shared and re-opened in the viewer without the original repo or
// any re-indexing. The on-disk shape is a superset of what `openvisio export`
// writes ({ graph, groupGraph }), so CLI exports import cleanly too.

import {
  GraphResponseSchema,
  GroupGraphResponseSchema,
  type GraphResponse,
  type GroupGraphResponse,
} from '@/lib/api/types'

export const BUNDLE_KIND = 'openvisio-graph'
export const BUNDLE_VERSION = 1

export interface GraphBundle {
  graph: GraphResponse
  groupGraph: GroupGraphResponse | null
}

function slug(name: string): string {
  return (
    (name || 'graph')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'graph'
  )
}

/** Serialize the loaded graph and trigger a browser download. */
export function downloadGraphBundle(
  graph: GraphResponse,
  groupGraph: GroupGraphResponse | null,
  now: number = Date.now(),
): void {
  const bundle = {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    exportedAt: now,
    repo: { name: graph.repo.name, file_count: graph.repo.file_count, total_loc: graph.repo.total_loc },
    graph,
    groupGraph,
  }
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug(graph.repo.name)}.openvisio.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Read + validate a bundle file (UI export or raw `openvisio export`). Throws a
 *  user-facing Error on anything that isn't a usable OpenVisio graph. */
export async function readGraphBundle(file: File): Promise<GraphBundle> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error('That file isn’t valid JSON.')
  }
  const obj = raw as { graph?: unknown; groupGraph?: unknown } | null
  if (!obj || typeof obj !== 'object' || obj.graph === undefined) {
    throw new Error('That file isn’t an OpenVisio graph export.')
  }

  const g = GraphResponseSchema.safeParse(obj.graph)
  if (!g.success) throw new Error('This graph file is malformed or from an incompatible version.')

  let groupGraph: GroupGraphResponse | null = null
  if (obj.groupGraph != null) {
    const gg = GroupGraphResponseSchema.safeParse(obj.groupGraph)
    // The architecture graph is a nice-to-have — drop a malformed one rather than
    // failing the whole import.
    if (gg.success) groupGraph = gg.data
  }

  return { graph: g.data, groupGraph }
}
