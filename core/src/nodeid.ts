// Stable, root-qualified string identity for graph nodes.
//
// The numeric `id` on files/symbols/edges is an in-memory adjacency index — it is
// reassigned every build and must never be persisted as cross-reindex identity.
// The STRING `nodeId` is the external identity that external consumers (editors,
// caches, incremental-update feeds) rely on. It is:
//
//   • Structural, not content-based — editing a function body does not change it
//     (content-hash ids were rejected: every keystroke would invalidate them).
//   • Root-qualified — prefixed by a per-root handle so two workspace roots in one
//     process never collide.
//   • Deterministic — same repo bytes → same ids, so an unchanged reindex is a no-op
//     for every consumer keyed on nodeId.
//
// Shape:  <rootId>::<relPath>                          (file)
//         <rootId>::<relPath>#<A.B.name>               (symbol; dotted = enclosing chain)
//         <rootId>::<relPath>#<name>@<ordinal>         (overloads / duplicate paths)
//         <kind>:<srcNodeId>-><tgtNodeId>              (edge)
//
// A rename is delete+create (a new nodeId), which is correct: a renamed symbol is a
// different node.

import { sha512 } from './hash.js'
import type { CodeEdge, CodeFile, CodeSymbol } from './types.js'

/**
 * Stable per-workspace-root handle: 12 hex chars of the normalized absolute root
 * path's hash. Path-derived, so it survives process restarts (unlike a process-
 * assigned counter) — which is what lets external caches key on nodeId across
 * restarts. Namespaces every node id by root.
 */
export function rootIdFor(absRootPath: string): string {
  return sha512(absRootPath).slice(0, 12)
}

/** `<rootId>::<relPath>` — the identity of a file node. */
export function fileNodeId(rootId: string, relPath: string): string {
  return `${rootId}::${relPath}`
}

/** Minimal shape needed to compute a structural id — satisfied by CodeSymbol. */
interface RangedNamed {
  name: string
  fullRange: readonly [number, number]
}

/**
 * Compute the structural nodeId of every symbol in ONE file, returned parallel to
 * `fileSymbols`. The dotted prefix is the chain of enclosing symbols, determined by
 * UTF-16 `fullRange` containment (smallest strict container wins). Symbols that
 * resolve to the same structural path — overloads, or genuine duplicate names — get
 * a stable `@ordinal` by source order; a unique path gets no suffix.
 *
 * Pure and deterministic: depends only on names and ranges, so it is directly
 * unit-testable with synthetic symbols and identical across unchanged reindexes.
 */
export function computeSymbolNodeIds(
  rootId: string,
  relPath: string,
  fileSymbols: readonly RangedNamed[],
): string[] {
  const n = fileSymbols.length
  // container[i] = index of the smallest symbol that STRICTLY encloses i, or -1.
  const container: number[] = new Array<number>(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const a = fileSymbols[i]!
    let bestJ = -1
    let bestSpan = Number.POSITIVE_INFINITY
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const b = fileSymbols[j]!
      const enclosesInclusive = b.fullRange[0] <= a.fullRange[0] && a.fullRange[1] <= b.fullRange[1]
      const strictlyLarger = b.fullRange[0] < a.fullRange[0] || a.fullRange[1] < b.fullRange[1]
      if (!enclosesInclusive || !strictlyLarger) continue
      const span = b.fullRange[1] - b.fullRange[0]
      if (span < bestSpan) {
        bestSpan = span
        bestJ = j
      }
    }
    container[i] = bestJ
  }

  // Dotted structural path per symbol, walking container links outward.
  const pathOf: string[] = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const parts: string[] = []
    let cur = i
    const guard = new Set<number>()
    while (cur !== -1 && !guard.has(cur)) {
      guard.add(cur) // defensive: never loop on a degenerate containment cycle
      parts.push(fileSymbols[cur]!.name)
      cur = container[cur]!
    }
    parts.reverse()
    pathOf[i] = parts.join('.')
  }

  // Group identical paths; disambiguate with a stable source-order ordinal.
  const groups = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const list = groups.get(pathOf[i]!)
    if (list) list.push(i)
    else groups.set(pathOf[i]!, [i])
  }
  const ids: string[] = new Array<string>(n)
  for (const [p, idxs] of groups) {
    if (idxs.length === 1) {
      ids[idxs[0]!] = `${rootId}::${relPath}#${p}`
    } else {
      idxs.forEach((idx, ord) => {
        ids[idx] = `${rootId}::${relPath}#${p}@${ord}`
      })
    }
  }
  return ids
}

/**
 * Assign `nodeId` in place to every file, symbol, and edge of a graph. Files and
 * symbols get structural ids; edges get `<kind>:<srcNodeId>-><tgtNodeId>` (import
 * endpoints are files, call endpoints are symbols). Runs once at the end of graph
 * assembly, after ranges and numeric ids exist.
 */
export function assignNodeIds(
  rootId: string,
  files: readonly CodeFile[],
  edges: readonly CodeEdge[],
  symbolsByFile: ReadonlyMap<number, CodeSymbol[]>,
): void {
  const fileNodeById = new Map<number, string>()
  for (const f of files) {
    f.nodeId = fileNodeId(rootId, f.path)
    fileNodeById.set(f.id, f.nodeId)
  }

  const symbolNodeById = new Map<number, string>()
  for (const f of files) {
    const syms = symbolsByFile.get(f.id) ?? []
    const ids = computeSymbolNodeIds(rootId, f.path, syms)
    for (let i = 0; i < syms.length; i++) {
      const s = syms[i]!
      s.nodeId = ids[i]!
      symbolNodeById.set(s.id, s.nodeId)
    }
  }

  for (const e of edges) {
    const src = e.kind === 'import' ? fileNodeById.get(e.sourceId) : symbolNodeById.get(e.sourceId)
    const tgt = e.kind === 'import' ? fileNodeById.get(e.targetId) : symbolNodeById.get(e.targetId)
    e.nodeId = `${e.kind}:${src ?? e.sourceId}->${tgt ?? e.targetId}`
  }
}
