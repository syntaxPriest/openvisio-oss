// Revision tracking — what makes incremental reindex cheap for consumers.
//
// Two numbers:
//   • graphRevision — a global monotonic counter bumped once per completed
//     reindex. Returned on every response so a consumer can detect a stale view.
//   • node.revision — the graphRevision at which THAT node last changed. Unchanged
//     nodes carry their prior revision forward, so an incremental-update feed can
//     ship only the genuinely-changed node ids and a consumer patches instead of
//     refetching.
//
// "Changed" is decided by a content signature per node: an edit that leaves a
// node's structural surface (name, kind, signature, ranges, edge endpoints/weight)
// identical does not bump its revision — consumers render structure, not bodies.

import type { CodeEdge, CodeFile, CodeGraph, CodeSymbol } from './types.js'

/**
 * Cross-reindex memory: for each nodeId, the signature it had and the revision at
 * which it last changed. Held by the long-lived Indexer; compared on each reindex.
 */
export interface RevisionState {
  sig: Map<string, string>
  rev: Map<string, number>
}

export function newRevisionState(): RevisionState {
  return { sig: new Map(), rev: new Map() }
}

// Signatures capture exactly the surface the UI renders — deliberately NOT the
// body — so a body-only edit bumps the file's revision (its sha changed) but not
// the symbol's.
function fileSig(f: CodeFile): string {
  return `f|${f.sha}`
}
function symbolSig(s: CodeSymbol): string {
  return `s|${s.kind}|${s.name}|${s.signature}|${s.fullRange[0]},${s.fullRange[1]}|${s.nameRange[0]},${s.nameRange[1]}|${s.exported ? 1 : 0}`
}
function edgeSig(e: CodeEdge): string {
  // nodeId already encodes kind + both endpoints; weight is the only other surface.
  return `e|${e.weight}`
}

/**
 * Stamp `revision` on every node of `graph` and return the nodeIds that changed at
 * `newRevision`. A node changes if it is new or its signature differs from the
 * prior build; otherwise it carries its previous revision. `graph.revision` is set
 * to `newRevision`. Mutates `state` so the next reindex compares against this build;
 * ids that vanished (rename/delete) are pruned from state.
 */
export function assignRevisions(
  graph: CodeGraph,
  state: RevisionState,
  newRevision: number,
): string[] {
  const changed: string[] = []
  const live = new Set<string>()

  const stamp = (nodeId: string, sig: string, set: (rev: number) => void): void => {
    live.add(nodeId)
    if (state.sig.get(nodeId) === sig) {
      set(state.rev.get(nodeId) ?? newRevision)
      return
    }
    state.sig.set(nodeId, sig)
    state.rev.set(nodeId, newRevision)
    set(newRevision)
    changed.push(nodeId)
  }

  for (const f of graph.files) stamp(f.nodeId, fileSig(f), (r) => (f.revision = r))
  for (const s of graph.symbols) stamp(s.nodeId, symbolSig(s), (r) => (s.revision = r))
  for (const e of graph.edges) stamp(e.nodeId, edgeSig(e), (r) => (e.revision = r))

  for (const id of [...state.sig.keys()]) {
    if (!live.has(id)) {
      state.sig.delete(id)
      state.rev.delete(id)
    }
  }

  graph.revision = newRevision
  return changed
}
