// Assemble the "Atlas": the whole codebase as one interconnected node-link
// graph — files + symbols (functions/methods/classes/types/interfaces/consts)
// wired by `defines` (file → symbol), `imports` (file → file), `calls`
// (function → function) and `extends`/`implements` (class → class/interface).
//
// Layout is a SOLID BALL: every file gets an even direction on the unit sphere
// (Fibonacci lattice) and a radial distance set by how connected it is — highly
// connected "hub" files sink toward the core, leaf files float to the outer
// shell. Node SIZE is exaggerated by degree, so the load-bearing nodes read as
// big bright cores. Deterministic — same graph, same ball (no Math.random, no
// client-side force simulation).

import type { GraphResponse } from '@/lib/api/types'
import { shortName } from '@/components/graph/encoding'

export type AtlasNodeType = 'file' | 'function' | 'method' | 'class' | 'interface' | 'type' | 'const'
export type AtlasLinkKind = 'imports' | 'defines' | 'calls' | 'extends' | 'implements'

export interface AtlasNode {
  id: string
  label: string
  type: AtlasNodeType
  /** The owning file id (for click-to-focus + filtering). */
  fileId: number
  /** Render radius — exaggerated by degree for files, by kind for symbols. */
  radius: number
  /** Precomputed world position — the viewer renders this, no client sim. */
  x: number
  y: number
  /** Depth — the atlas is a true 3D ball, not a flat disc. */
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
  method: '#2dd4bf', // teal
  class: '#a855f7', // purple
  interface: '#c084fc', // violet
  type: '#94a3b8', // slate
  const: '#64748b', // dim slate
}

export const ATLAS_LINK_COLOR: Record<AtlasLinkKind, string> = {
  imports: '#3b82f6',
  defines: '#475569',
  calls: '#f59e0b', // amber (matches the spotlight convention)
  extends: '#ec4899', // pink — inheritance
  implements: '#34d399', // green — interface implementation
}

export function buildAtlas(graph: GraphResponse): AtlasData {
  const nodes: AtlasNode[] = []
  const links: AtlasLink[] = []
  const nodeCounts: Record<AtlasNodeType, number> = {
    file: 0,
    function: 0,
    method: 0,
    class: 0,
    interface: 0,
    type: 0,
    const: 0,
  }
  const linkCounts: Record<AtlasLinkKind, number> = {
    imports: 0,
    defines: 0,
    calls: 0,
    extends: 0,
    implements: 0,
  }

  const fileNodeId = (id: number) => `f${id}`
  const symNodeId = (id: number) => `s${id}`

  // Every node shows up — no capping. The viewer draws the whole codebase with
  // WebGL instancing (one Points draw call + one LineSegments draw call).
  const files = graph.files
  const fileIds = new Set(files.map((f) => f.id))
  const symbols = graph.symbols.filter((s) => fileIds.has(s.file_id))

  // ---- Degree: how connected each file is. Drives BOTH node size and radial
  // depth in the ball (hubs are big and pulled to the core). ----
  const fileDegree = new Map<number, number>()
  const bumpDeg = (id: number, n = 1) => {
    if (fileIds.has(id)) fileDegree.set(id, (fileDegree.get(id) ?? 0) + n)
  }
  for (const e of graph.edges) {
    if (e.edge_kind === 'import' && e.source_kind === 'file' && e.target_kind === 'file') {
      bumpDeg(e.source_id)
      bumpDeg(e.target_id)
    }
  }
  // The symbols a file defines add a little mass — a fat file is a hub too.
  for (const s of symbols) bumpDeg(s.file_id, 0.2)
  let maxDeg = 1
  for (const d of fileDegree.values()) if (d > maxDeg) maxDeg = d

  // Deterministic hash → [-1, 1] from an integer id (no Math.random, so reloads
  // don't reshuffle the ball).
  const jitter = (n: number) => {
    let h = (n * 2654435761) >>> 0
    h ^= h >>> 15
    h = (h * 2246822519) >>> 0
    h ^= h >>> 13
    return ((h >>> 0) / 4294967295) * 2 - 1
  }

  // ---- Solid ball. Fibonacci direction on the unit sphere (even angular
  // coverage) × a radial distance driven by connectedness: hubs to the core,
  // leaves to the shell. ----
  const RADIUS = Math.max(180, 30 * Math.sqrt(Math.max(1, files.length)))
  const N = files.length
  const filePos = new Map<number, { x: number; y: number; z: number }>()
  files.forEach((f, i) => {
    const deg = fileDegree.get(f.id) ?? 0
    const t = Math.min(1, deg / maxDeg) // 0 (leaf) .. 1 (hub)
    const yy = N > 1 ? 1 - (i / (N - 1)) * 2 : 0 // 1 .. -1
    const ring = Math.sqrt(Math.max(0, 1 - yy * yy))
    const theta = i * 2.399963 // golden angle
    const ux = Math.cos(theta) * ring
    const uz = Math.sin(theta) * ring
    // Hubs (t→1) pull to the core; leaves (t→0) push to the shell. Jitter adds
    // volume so shells don't look like hard rings.
    const rr = RADIUS * (0.16 + 0.84 * Math.pow(1 - t, 1.4)) * (0.92 + 0.08 * jitter(f.id))
    filePos.set(f.id, { x: ux * rr, y: yy * rr, z: uz * rr })
  })

  for (const f of files) {
    const p = filePos.get(f.id)!
    const deg = fileDegree.get(f.id) ?? 0
    nodes.push({
      id: fileNodeId(f.id),
      label: shortName(f.path),
      type: 'file',
      fileId: f.id,
      // Exaggerated by connections: leaves ~5, hubs large (shader caps on-screen).
      radius: 5 + Math.sqrt(deg) * 4 + Math.min(6, Math.sqrt(f.loc) / 6),
      x: p.x,
      y: p.y,
      z: p.z,
    })
    nodeCounts.file++
  }

  // Symbols orbit their owning file on a small 3D shell (golden-angle direction),
  // sized by kind so classes/interfaces read larger than their members.
  const SYM_RADIUS: Record<AtlasNodeType, number> = {
    file: 5,
    class: 4.2,
    interface: 3.8,
    type: 2.8,
    function: 2.8,
    method: 2.3,
    const: 2.1,
  }
  const symOrbit = new Map<number, number>()
  const symIds = new Set<number>()
  for (const s of symbols) {
    const type = s.kind as AtlasNodeType
    if (!(type in nodeCounts)) continue
    const fp = filePos.get(s.file_id)!
    const k = symOrbit.get(s.file_id) ?? 0
    symOrbit.set(s.file_id, k + 1)
    const yy = ((k % 16) / 15) * 2 - 1 // -1..1 inclination band
    const ring = Math.sqrt(Math.max(0, 1 - yy * yy))
    const ang = k * 2.399963 // golden-angle azimuth
    const orad = 9 + k * 1.2
    nodes.push({
      id: symNodeId(s.id),
      label: s.name,
      type,
      fileId: s.file_id,
      radius: SYM_RADIUS[type] ?? 2.4,
      x: fp.x + Math.cos(ang) * ring * orad,
      y: fp.y + yy * orad,
      z: fp.z + Math.sin(ang) * ring * orad,
    })
    symIds.add(s.id)
    nodeCounts[type]++
    // defines: the file → the symbol it declares.
    links.push({ source: fileNodeId(s.file_id), target: symNodeId(s.id), kind: 'defines' })
    linkCounts.defines++
  }

  // Nothing is dropped.
  const truncated = false

  for (const e of graph.edges) {
    if (e.edge_kind === 'import' && e.source_kind === 'file' && e.target_kind === 'file') {
      if (!fileIds.has(e.source_id) || !fileIds.has(e.target_id)) continue
      links.push({ source: fileNodeId(e.source_id), target: fileNodeId(e.target_id), kind: 'imports' })
      linkCounts.imports++
    } else if (e.source_kind === 'symbol' && e.target_kind === 'symbol') {
      // calls / extends / implements — only if both symbol nodes are present.
      if (!symIds.has(e.source_id) || !symIds.has(e.target_id)) continue
      const kind: AtlasLinkKind | null =
        e.edge_kind === 'call'
          ? 'calls'
          : e.edge_kind === 'extends'
            ? 'extends'
            : e.edge_kind === 'implements'
              ? 'implements'
              : null
      if (!kind) continue
      links.push({ source: symNodeId(e.source_id), target: symNodeId(e.target_id), kind })
      linkCounts[kind]++
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
