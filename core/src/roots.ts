// Multi-root registry — the set of workspace roots one process serves.
//
// One process serves many roots (lower memory than one process per folder): each
// root gets its own Indexer, and every operation is addressed by an explicit
// `rootId` — there is no implicit "current" root. Graphs are fully isolated:
// because nodeIds are root-qualified (see nodeid.ts), no id or edge can bleed
// between roots even though they share a process. Storage, when a cacheDir is
// given, is namespaced by rootId on disk.

import * as path from 'node:path'
import { Indexer, type BuildOptions, type IndexChanges } from './build.js'
import { rootIdFor } from './nodeid.js'
import type { CodeGraph } from './types.js'

export interface RegisteredRoot {
  /** Stable, path-derived handle (see rootIdFor) — the key for every request. */
  rootId: string
  /** Absolute, normalized root path. */
  rootPath: string
}

export class RootRegistry {
  private readonly roots = new Map<string, { root: RegisteredRoot; indexer: Indexer }>()

  constructor(
    private readonly opts: { cacheDir?: string; buildOptions?: BuildOptions } = {},
  ) {}

  /** The rootId a path resolves to, without registering it. */
  rootIdForPath(rootPath: string): string {
    return rootIdFor(path.resolve(rootPath))
  }

  /** Register a workspace root. Idempotent — re-registering a path returns the same
   *  rootId and keeps the existing Indexer (and its warm cache). */
  register(rootPath: string): string {
    const absRoot = path.resolve(rootPath)
    const rootId = rootIdFor(absRoot)
    if (!this.roots.has(rootId)) {
      const dbPath = this.opts.cacheDir ? path.join(this.opts.cacheDir, rootId) : undefined
      const indexer = new Indexer(absRoot, this.opts.buildOptions ?? {}, dbPath)
      this.roots.set(rootId, { root: { rootId, rootPath: absRoot }, indexer })
    }
    return rootId
  }

  /** Deregister a root and release its Indexer/store. No-op if unknown. */
  unregister(rootId: string): void {
    const entry = this.roots.get(rootId)
    if (!entry) return
    entry.indexer.close()
    this.roots.delete(rootId)
  }

  has(rootId: string): boolean {
    return this.roots.has(rootId)
  }

  list(): RegisteredRoot[] {
    return [...this.roots.values()].map((e) => e.root)
  }

  private require(rootId: string): Indexer {
    const entry = this.roots.get(rootId)
    if (!entry) throw new Error(`unknown root: ${rootId}`)
    return entry.indexer
  }

  /** Build (cold) the graph for one root. */
  build(rootId: string): Promise<CodeGraph> {
    return this.require(rootId).build()
  }

  /** Reindex one root, returning its graph and the change set (incl. changedNodeIds). */
  reindex(rootId: string): Promise<{ graph: CodeGraph; changes: IndexChanges }> {
    return this.require(rootId).reindex()
  }

  /** Release every root's Indexer. */
  closeAll(): void {
    for (const e of this.roots.values()) e.indexer.close()
    this.roots.clear()
  }
}
