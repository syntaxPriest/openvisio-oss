// The CodeGraph contract — the single deterministic data model the whole
// engine produces and every consumer (CLI MCP tools, and later the web
// viewer) reads. Intentionally LLM-free: every field here is computed by
// scanning + tree-sitter parsing, so it is byte-stable across runs.
//
// Internally we use camelCase + numeric ids. The frontend's existing
// snake_case GraphResponse shape (lib/api/types.ts) is a boundary concern —
// a thin adapter maps to it only when/if the viewer is flipped to real data
// (Phase 5). Keeping the core independent avoids coupling the npx CLI to the
// Next.js app.

/** Languages we can parse into symbols/imports. `other` = scanned but not parsed. */
export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'kotlin'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'scala'
  | 'dart'
  | 'zig'
  | 'lua'
  | 'r'
  | 'elixir'
  | 'elm'
  | 'ocaml'
  | 'rescript'
  | 'solidity'
  | 'tlaplus'
  | 'objc'
  | 'bash'
  | 'vue'
  | 'html'
  | 'css'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'embedded_template'
  | 'systemrdl'
  | 'ql'
  | 'elisp'
  // Template + doc languages with no tree-sitter grammar: scanned as graph nodes
  // (no symbols), but kept because they're load-bearing in real projects — Twig/
  // Blade drive PHP views, and markdown READMEs explain the project itself.
  | 'twig'
  | 'blade'
  | 'markdown'
  // Electronic design / hardware files (KiCad, EAGLE, Gerber, drill, plot). No
  // grammar — scanned as graph nodes so hardware repos read as their own
  // category instead of a generic `other` blob. (GitHub Linguist mislabels many
  // of these as "Prolog".)
  | 'eda'
  | 'other'

/** Symbol kinds, deliberately aligned with the frontend SymbolKind enum.
 *  `method` = a function that is a member of a class/object (nested), kept
 *  distinct from top-level `function` so the graph mirrors codebase-memory's
 *  Function/Method split and the enclosing class shows in the nodeId chain. */
export type SymbolKind = 'function' | 'method' | 'class' | 'const' | 'type' | 'interface'

/**
 * A half-open `[start, end)` source range in **UTF-16 code units** (whole-file
 * offsets). This is the unit web-tree-sitter reports and the unit VS Code's
 * Position/positionAt consumes, so it converts to an editor Position with no
 * encoding step — see core/src/position.ts. Never store byte offsets here.
 */
export type OffsetRange = [start: number, end: number]

export interface CodeFile {
  id: number
  /**
   * Stable, root-qualified string identity (`<rootId>::<path>`) — the external
   * identity for caches and editor state. Survives reindexes of unchanged files;
   * see core/src/nodeid.ts. The numeric `id` is an internal, per-build adjacency
   * index and must not be used as cross-reindex identity.
   */
  nodeId: string
  /** Repo-relative POSIX path, e.g. "lib/api/client.ts". */
  path: string
  language: Language
  /** Non-blank lines of code. */
  loc: number
  /** Short content hash (deterministic; for cache invalidation + change detection). */
  sha: string
  /** File mtime in ms (used by --watch; not part of ranking). */
  lastModified: number
  /**
   * UTF-16 offset at which each line starts; `lineStarts[0] === 0`, one entry
   * per line. Turns a symbol's UTF-16 range offset into an editor `Position`
   * (line + character) via `offsetToPosition`. Recomputed each build from file
   * content — held in memory, not serialized.
   */
  lineStarts: number[]
  /** graphRevision at which this file last changed (its sha changed). */
  revision: number
}

export interface CodeSymbol {
  id: number
  /**
   * Stable, root-qualified structural identity, e.g.
   * `<rootId>::src/auth/service.ts#AuthService.login`. Unchanged by edits to the
   * body; see core/src/nodeid.ts. External identity for the UI; the numeric `id`
   * is internal only.
   */
  nodeId: string
  fileId: number
  name: string
  kind: SymbolKind
  /** Single-line, elided declaration signature (no body). */
  signature: string
  /** 1-based inclusive line range of the declaration. */
  startLine: number
  endLine: number
  /**
   * UTF-16 range of the identifier alone — the click-to-jump target. Slicing the
   * file source by this range yields exactly `name`.
   */
  nameRange: OffsetRange
  /**
   * UTF-16 range of the whole declaration (incl. decorators/modifiers). Editor
   * features anchor here (gutter annotations, scoped views). Always encloses
   * `nameRange`.
   */
  fullRange: OffsetRange
  /** True if the symbol is part of the file's public surface (exported). */
  exported: boolean
  /**
   * graphRevision at which this symbol's rendered surface (name/kind/signature/
   * ranges/exported) last changed. A body-only edit does not advance it.
   */
  revision: number
}

/**
 * A directed edge. For `import`, source/target are FILE ids (file imports file).
 * For `calls`/`extends`/`implements`, source/target are SYMBOL ids — a function
 * calls a function, or a class extends/implements a class or interface
 * (heuristic, resolved by name within the same file or an imported file).
 */
export interface CodeEdge {
  id: number
  /**
   * Stable string identity derived from the endpoints' nodeIds
   * (`<kind>:<srcNodeId>-><tgtNodeId>`), so an edge survives reindex as long as
   * both endpoints do. See core/src/nodeid.ts.
   */
  nodeId: string
  sourceId: number
  targetId: number
  kind: 'import' | 'calls' | 'extends' | 'implements'
  /** How many import specifiers / call sites back this edge (≥1). */
  weight: number
  /** graphRevision at which this edge last changed (appeared or weight changed). */
  revision: number
}

export interface CodeGraph {
  /**
   * Global monotonic build revision — bumped once per completed reindex. Returned
   * on every response so consumers can detect a stale view; see core/src/revision.ts.
   */
  revision: number
  /** Absolute repo root that was scanned. */
  rootPath: string
  /** Display name (basename of rootPath). */
  name: string
  files: CodeFile[]
  symbols: CodeSymbol[]
  edges: CodeEdge[]
  // ---- Derived indices (built once, not serialized) ----
  /** file id → in/out import edge lists (for O(1) neighbor lookups). */
  adjacency: Map<number, { in: CodeEdge[]; out: CodeEdge[] }>
  filesById: Map<number, CodeFile>
  fileIdByPath: Map<string, number>
  symbolsByFile: Map<number, CodeSymbol[]>
}

/** A raw import reference extracted from a file, before resolution to a file id. */
export interface RawImport {
  /** The import specifier as written, e.g. "./client" or "react". */
  specifier: string
}

/** A raw call site: the callee name as written + the line it occurs on (so the
 *  enclosing caller symbol can be found later). Resolved to a symbol in build. */
export interface RawCall {
  callee: string
  /** 1-based line of the call site. */
  line: number
}

/** A raw inheritance reference: a supertype name written in a class/interface
 *  heritage clause + the line, plus whether it is an `extends` (superclass /
 *  interface extension) or `implements` (interface implementation). The subclass
 *  is the enclosing symbol at `line`; the supertype is resolved to a symbol in
 *  build, exactly like a call. */
export interface RawInherit {
  supertype: string
  relation: 'extends' | 'implements'
  /** 1-based line of the heritage clause. */
  line: number
}

/** Per-file parse output. `nodeId` is omitted here — it is computed post-parse
 *  from cross-file containment/ordinals in core/src/nodeid.ts, not at parse time. */
export interface ParseResult {
  symbols: Omit<CodeSymbol, 'id' | 'fileId' | 'nodeId' | 'revision'>[]
  imports: RawImport[]
  calls: RawCall[]
  inherits: RawInherit[]
}
