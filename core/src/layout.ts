// Deterministic 2D layout for the file graph. Computed ONCE in the engine so the
// viewer renders precomputed coordinates instead of running an O(n²) force sim
// in the browser every frame (the approach that lets graph UIs stay smooth at
// tens of thousands of nodes).
//
// Strategy (mirrors a "structured-first, then refine" force layout):
//   1. Seed each file on a ring chosen by its folder cluster — so folders fall
//      into visually separated clusters by default, in O(n), deterministically.
//   2. Refine locally: Barnes-Hut quadtree repulsion (O(n log n)) + edge springs
//      + anchor springs that pull each node back toward its ring seed. Fixed
//      iteration count → byte-stable across runs. No Math.random / no clock.

import type { CodeGraph } from './types.js'
import { computeCentrality } from './rank.js'

export interface LayoutNode {
  id: number
  x: number
  y: number
}

export interface GraphLayout {
  nodes: LayoutNode[]
}

export interface LayoutOptions {
  /** Folder depth (path segments) used as the cluster key. Default 2. */
  clusterDepth?: number
  /** Refinement iterations. Default 40. */
  iterations?: number
}

// Tuned constants (a 2D adaptation of a ForceAtlas2-with-anchors layout).
const RING_BASE = 500
const RING_SPREAD = 250
const JITTER = 40
const REPULSION = 1400 // inverse-square; scaled for ~500-unit ring radii
const ATTRACTION = 1 // linear edge spring (large forces get velocity-capped)
const ANCHOR_K = 0.25 // how strongly a node sticks to its folder-ring seed
const MAX_STEP = 8 // per-iteration velocity cap → bounded, stable movement
const THETA = 1.2 // Barnes-Hut opening angle
const MAX_DEPTH = 22 // quadtree subdivision cap (handles coincident points)

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic [0,1) generator (xorshift32), advanced in place. */
function nextRand(state: { s: number }): number {
  let x = state.s || 1
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.s = x >>> 0
  return (state.s & 0xffffff) / 0x1000000
}

/** Folder cluster key: the first `depth` directory segments (filename excluded). */
function clusterKey(path: string, depth: number): string {
  const segs = path.split('/')
  if (segs.length <= 1) return '.'
  return segs.slice(0, Math.min(depth, segs.length - 1)).join('/')
}

// ---- Barnes-Hut quadtree (mass-accumulating) ----
interface Quad {
  cx: number
  cy: number
  hs: number // half-size
  mass: number
  mx: number // Σ x·mass
  my: number // Σ y·mass
  body: number // single-body index, or -1
  kids: Quad[] | null
  depth: number
}

function makeQuad(cx: number, cy: number, hs: number, depth: number): Quad {
  return { cx, cy, hs, mass: 0, mx: 0, my: 0, body: -1, kids: null, depth }
}

function quadrant(q: Quad, x: number, y: number): number {
  return (x >= q.cx ? 1 : 0) + (y >= q.cy ? 2 : 0)
}

function subdivide(q: Quad): void {
  const h = q.hs / 2
  const d = q.depth + 1
  q.kids = [
    makeQuad(q.cx - h, q.cy - h, h, d),
    makeQuad(q.cx + h, q.cy - h, h, d),
    makeQuad(q.cx - h, q.cy + h, h, d),
    makeQuad(q.cx + h, q.cy + h, h, d),
  ]
}

function insert(q: Quad, i: number, xs: Float64Array, ys: Float64Array, ms: Float64Array): void {
  q.mass += ms[i]!
  q.mx += xs[i]! * ms[i]!
  q.my += ys[i]! * ms[i]!
  if (q.body === -1 && q.kids === null) {
    q.body = i
    return
  }
  if (q.kids === null) {
    if (q.depth >= MAX_DEPTH) return // coincident cluster — keep as one mass
    subdivide(q)
    const prev = q.body
    q.body = -1
    insert(q.kids![quadrant(q, xs[prev]!, ys[prev]!)]!, prev, xs, ys, ms)
  }
  insert(q.kids![quadrant(q, xs[i]!, ys[i]!)]!, i, xs, ys, ms)
}

function repulse(
  q: Quad,
  i: number,
  xs: Float64Array,
  ys: Float64Array,
  ms: Float64Array,
  acc: { fx: number; fy: number },
): void {
  if (q.mass === 0) return
  if (q.kids === null && q.body === i) return // self
  const comX = q.mx / q.mass
  const comY = q.my / q.mass
  let dx = xs[i]! - comX
  let dy = ys[i]! - comY
  let d2 = dx * dx + dy * dy
  if (d2 < 1e-6) {
    dx = (i % 7) * 0.01 + 0.01
    dy = (i % 5) * 0.01 + 0.01
    d2 = dx * dx + dy * dy
  }
  // Far enough (or a leaf) → treat the whole cell as one mass.
  if (q.kids === null || (q.hs * 2) / Math.sqrt(d2) < THETA) {
    const d = Math.sqrt(d2)
    const fmag = (REPULSION * ms[i]! * q.mass) / d2 // inverse-square magnitude
    acc.fx += (dx / d) * fmag
    acc.fy += (dy / d) * fmag
    return
  }
  for (const kid of q.kids) repulse(kid, i, xs, ys, ms, acc)
}

export function computeGraphLayout(graph: CodeGraph, opts: LayoutOptions = {}): GraphLayout {
  const files = graph.files
  const n = files.length
  console.error(`[layout] computing layout for ${n} nodes`)
  if (n === 0) return { nodes: [] }

  const depth = opts.clusterDepth ?? 2
  const iterations = opts.iterations ?? 40

  // Mass: load-bearing files (high centrality) carry more — they anchor harder
  // and push neighbours out, forming stable cores.
  const centrality = computeCentrality(graph)

  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const ax = new Float64Array(n) // anchor (ring seed)
  const ay = new Float64Array(n)
  const ms = new Float64Array(n)
  const indexById = new Map<number, number>()

  for (let i = 0; i < n; i++) {
    const f = files[i]!
    indexById.set(f.id, i)
    const h = fnv1a(clusterKey(f.path, depth))
    const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2
    const r = RING_BASE + (((h >> 16) & 0xff) / 0xff) * RING_SPREAD
    const seed = { s: fnv1a(f.path) }
    const px = Math.cos(angle) * r + (nextRand(seed) * 2 - 1) * JITTER
    const py = Math.sin(angle) * r + (nextRand(seed) * 2 - 1) * JITTER
    xs[i] = px
    ys[i] = py
    ax[i] = px
    ay[i] = py
    ms[i] = 1 + (centrality.scoreByFile.get(f.id) ?? 0) * 2
  }

  // Import edges as springs (both endpoints must be files we placed).
  const es: number[] = []
  const et: number[] = []
  for (const e of graph.edges) {
    if (e.kind !== 'import') continue
    const s = indexById.get(e.sourceId)
    const t = indexById.get(e.targetId)
    if (s === undefined || t === undefined || s === t) continue
    es.push(s)
    et.push(t)
  }
  console.error(`[layout] ${es.length} spring edges`)

  const fx = new Float64Array(n)
  const fy = new Float64Array(n)
  const acc = { fx: 0, fy: 0 }

  for (let iter = 0; iter < iterations; iter++) {
    if (iter % 10 === 0) console.error(`[layout] iteration ${iter + 1}/${iterations}`)
    fx.fill(0)
    fy.fill(0)

    // Build the quadtree over current positions.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < n; i++) {
      if (xs[i]! < minX) minX = xs[i]!
      if (ys[i]! < minY) minY = ys[i]!
      if (xs[i]! > maxX) maxX = xs[i]!
      if (ys[i]! > maxY) maxY = ys[i]!
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const hs = Math.max(maxX - minX, maxY - minY) / 2 + 1
    const root = makeQuad(cx, cy, hs, 0)
    for (let i = 0; i < n; i++) insert(root, i, xs, ys, ms)

    // Repulsion (Barnes-Hut).
    for (let i = 0; i < n; i++) {
      acc.fx = 0
      acc.fy = 0
      repulse(root, i, xs, ys, ms, acc)
      fx[i]! += acc.fx
      fy[i]! += acc.fy
    }

    // Edge springs (linear; large forces are velocity-capped below).
    for (let k = 0; k < es.length; k++) {
      const s = es[k]!
      const t = et[k]!
      const dx = xs[t]! - xs[s]!
      const dy = ys[t]! - ys[s]!
      fx[s]! += dx * ATTRACTION
      fy[s]! += dy * ATTRACTION
      fx[t]! -= dx * ATTRACTION
      fy[t]! -= dy * ATTRACTION
    }

    // Anchor springs back to the folder-ring seed.
    for (let i = 0; i < n; i++) {
      fx[i]! += (ax[i]! - xs[i]!) * ANCHOR_K * ms[i]!
      fy[i]! += (ay[i]! - ys[i]!) * ANCHOR_K * ms[i]!
    }

    // Velocity-capped integration → bounded, stable movement.
    for (let i = 0; i < n; i++) {
      const fm = Math.sqrt(fx[i]! * fx[i]! + fy[i]! * fy[i]!)
      const speed = fm > MAX_STEP ? MAX_STEP / (fm + 1e-3) : 1
      xs[i]! += fx[i]! * speed
      ys[i]! += fy[i]! * speed
    }
  }

  console.error(`[layout] done: ${n} nodes placed`)
  const nodes: LayoutNode[] = new Array(n)
  for (let i = 0; i < n; i++) {
    nodes[i] = { id: files[i]!.id, x: Math.round(xs[i]!), y: Math.round(ys[i]!) }
  }
  return { nodes }
}
