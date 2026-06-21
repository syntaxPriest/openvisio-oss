// Public API for @openvisio/core — the deterministic code-graph engine.
// The MCP CLI (and, later, the web viewer adapter) import only from here.

export type {
  Language,
  SymbolKind,
  CodeFile,
  CodeSymbol,
  CodeEdge,
  CodeGraph,
  RawImport,
  ParseResult,
} from './types.js'

export { scanRepo, type ScannedFile, type ScanOptions } from './scan.js'
export { parseFile } from './parse/index.js'
export {
  buildGraph,
  assembleGraph,
  Indexer,
  type BuildOptions,
  type AssembleContext,
  type ParseCache,
  type IndexChanges,
} from './build.js'
export {
  computeCentrality,
  rankByCentrality,
  rankForTask,
  type Centrality,
  type RankedFile,
  type RankForTaskOptions,
} from './rank.js'
export {
  buildSkeleton,
  formatSymbol,
  type SkeletonOptions,
  type ViewResult,
} from './skeleton.js'
export { buildNeighborhood, type NeighborhoodOptions } from './neighborhood.js'
export { resolveContext, type ResolveContextOptions } from './resolve.js'
export {
  computeChurn,
  buildHotspots,
  type ChurnOptions,
  type HotspotsOptions,
} from './churn.js'
export {
  computeGraphLayout,
  type GraphLayout,
  type LayoutNode,
  type LayoutOptions,
} from './layout.js'
export { estimateTokens, TokenBudget } from './budget.js'
export type { Store } from './store.js'
export { sha512 } from './hash.js'
export {
  sliceSymbolSource,
  type SliceResult,
  type SliceOptions,
} from './slice.js'
export {
  findSymbols,
  resolveFileTarget,
  dependentsOf,
  dependenciesOf,
  type SymbolHit,
  type FindSymbolOptions,
  type DependencyHit,
} from './query.js'
