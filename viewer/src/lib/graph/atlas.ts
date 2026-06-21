// Assemble the "Atlas": the whole codebase as one interconnected node-link
// graph — files + symbols (functions/classes/types/interfaces/consts) wired by
// `defines` (file → symbol) and `imports` (file → file). Node POSITIONS are the
// engine's deterministic ring-by-folder + Barnes-Hut layout (graph.layout); the
// viewer renders them directly — no client-side force simulation. Heuristic
// `calls` (function → function) land here once the core engine extracts them.

import type { GraphResponse } from '@/lib/api/types'
import { shortName } from '@/components/graph/encoding'

export type AtlasNodeType = 'file' | 'function' | 'class' | 'interface' | 'type' | 'const'
export type AtlasLinkKind = 'imports' | 'defines' | 'calls'

export interface AtlasNode {
  id: string
  label: string
  type: AtlasNodeType
  /** The owning file id (for click-to-focus + filtering). */
  fileId: number
  /** Render radius (files scale with LOC; symbols are small). */
  radius: number
  /** Precomputed world position — the viewer renders this, no client sim. */
  x: number
  y: number
  /** Depth — the atlas is a true 3D galaxy: files dome up from the centre and
   *  symbols orbit their file on a 3D shell. */
  z: number
}

export interface AtlasLink {
  source: string
  target: string
  kind: AtlasLinkKind
}

export interface AtlasData {
  nodes: AtlasNode[]
  links: AtlasLink[]
  nodeCounts: Record<AtlasNodeType, number>
  linkCounts: Record<AtlasLinkKind, number>
  /** True when the repo exceeded the node budget and we rendered a subset. */
  truncated: boolean
  /** Total file/symbol counts in the source graph, before any capping. */
  totals: { files: number; symbols: number }
}

/** Color per node type — mirrors the codebase-memory legend palette. */
export const ATLAS_NODE_COLOR: Record<AtlasNodeType, string> = {
  file: '#3b82f6', // blue
  function: '#22d3ee', // cyan
  class: '#a855f7', // purple
  interface: '#c084fc', // violet
  type: '#94a3b8', // slate
  const: '#64748b', // dim slate
}

export const ATLAS_LINK_COLOR: Record<AtlasLinkKind, string> = {
  imports: '#3b82f6',
  defines: '#475569',
  calls: '#f59e0b', // amber (matches the spotlight convention)
}

export function buildAtlas(graph: GraphResponse): AtlasData {
  const nodes: AtlasNode[] = []
  const links: AtlasLink[] = []
  const nodeCounts: Record<AtlasNodeType, number> = {
    file: 0,
    function: 0,
    class: 0,
    interface: 0,
    type: 0,
    const: 0,
  }
  const linkCounts: Record<AtlasLinkKind, number> = { imports: 0, defines: 0, calls: 0 }

  const fileNodeId = (id: number) => `f${id}`
  const symNodeId = (id: number) => `s${id}`

  // Every node shows up — no capping. The viewer draws the whole codebase with
  // WebGL instancing (one Points draw call + one LineSegments draw call), so even
  // large repos render as one galaxy.
  const files = graph.files
  const fileIds = new Set(files.map((f) => f.id))
  const symbols = graph.symbols.filter((s) => fileIds.has(s.file_id))

  // File positions come from the engine's deterministic layout (ring-by-folder +
  // Barnes-Hut). Fall back to a golden-angle spiral if no layout was supplied.
  const layoutPos = new Map<number, { x: number; y: number }>()
  for (const ln of graph.layout?.nodes ?? []) layoutPos.set(ln.id, { x: ln.x, y: ln.y })
  const filePos = new Map<number, { x: number; y: number }>()
  files.forEach((f, i) => {
    const p = layoutPos.get(f.id)
    if (p) filePos.set(f.id, p)
    else {
      const a = i * 2.399963 // golden angle
      const r = 40 * Math.sqrt(i + 1)
      filePos.set(f.id, { x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
  })

  // ---- Lift the flat layout into 3D. Files dome up from the centroid (central,
  // load-bearing files rise toward the viewer) with a little deterministic jitter
  // for volume; symbols then orbit their file on a 3D shell. Deterministic — same
  // graph, same galaxy. ----
  let cx = 0
  let cy = 0
  for (const p of filePos.values()) {
    cx += p.x
    cy += p.y
  }
  const nf = filePos.size || 1
  cx /= nf
  cy /= nf
  let maxR = 1
  for (const p of filePos.values()) {
    const d = Math.hypot(p.x - cx, p.y - cy)
    if (d > maxR) maxR = d
  }
  // Deterministic hash → [-1, 1] from an integer id (no Math.random, so reloads
  // don't reshuffle the galaxy).
  const jitter = (n: number) => {
    let h = (n * 2654435761) >>> 0
    h ^= h >>> 15
    h = (h * 2246822519) >>> 0
    h ^= h >>> 13
    return ((h >>> 0) / 4294967295) * 2 - 1
  }
  const Z_BULGE = maxR * 0.7
  const fileZ = new Map<number, number>()
  for (const f of files) {
    const p = filePos.get(f.id)!
    const rr = Math.hypot(p.x - cx, p.y - cy) / maxR
    fileZ.set(f.id, Z_BULGE * (1 - rr * rr) + jitter(f.id) * maxR * 0.14)
  }

  for (const f of files) {
    const p = filePos.get(f.id)!
    nodes.push({
      id: fileNodeId(f.id),
      label: shortName(f.path),
      type: 'file',
      fileId: f.id,
      radius: Math.max(3, Math.min(9, 3 + Math.sqrt(f.loc) / 6)),
      x: p.x,
      y: p.y,
      z: fileZ.get(f.id) ?? 0,
    })
    nodeCounts.file++
  }

  // Symbols orbit their owning file on a 3D shell (golden-angle azimuth × evenly
  // sliced inclination) — deterministic, and tight enough to stay near the file.
  const symOrbit = new Map<number, number>()
  const symIds = new Set<number>()
  for (const s of symbols) {
    if (!fileIds.has(s.file_id)) continue
    const type = s.kind as AtlasNodeType
    if (!(type in nodeCounts)) continue
    const fp = filePos.get(s.file_id)!
    const fz = fileZ.get(s.file_id) ?? 0
    const k = symOrbit.get(s.file_id) ?? 0
    symOrbit.set(s.file_id, k + 1)
    const ang = k * 2.399963 // golden angle azimuth
    const zoff = ((k % 16) / 15) * 2 - 1 // -1..1 inclination band
    const ring = Math.sqrt(Math.max(0, 1 - zoff * zoff))
    const orad = 7 + k * 1.1
    nodes.push({
      id: symNodeId(s.id),
      label: s.name,
      type,
      fileId: s.file_id,
      radius: 2.4,
      x: fp.x + Math.cos(ang) * ring * orad,
      y: fp.y + Math.sin(ang) * ring * orad,
      z: fz + zoff * orad,
    })
    symIds.add(s.id)
    nodeCounts[type]++
    // defines: the file → the symbol it declares.
    links.push({ source: fileNodeId(s.file_id), target: symNodeId(s.id), kind: 'defines' })
    linkCounts.defines++
  }

  // Nothing is dropped any more.
  const truncated = false

  for (const e of graph.edges) {
    if (e.edge_kind === 'import' && e.source_kind === 'file' && e.target_kind === 'file') {
      if (!fileIds.has(e.source_id) || !fileIds.has(e.target_id)) continue
      links.push({ source: fileNodeId(e.source_id), target: fileNodeId(e.target_id), kind: 'imports' })
      linkCounts.imports++
    } else if (e.edge_kind === 'call' && e.source_kind === 'symbol' && e.target_kind === 'symbol') {
      // Only if both symbol nodes are present (they may be dropped under the
      // exported-only cap on big repos).
      if (!symIds.has(e.source_id) || !symIds.has(e.target_id)) continue
      links.push({ source: symNodeId(e.source_id), target: symNodeId(e.target_id), kind: 'calls' })
      linkCounts.calls++
    }
  }

  return {
    nodes,
    links,
    nodeCounts,
    linkCounts,
    truncated,
    totals: { files: graph.files.length, symbols: graph.symbols.length },
  }
}
