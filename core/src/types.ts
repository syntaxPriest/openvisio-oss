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

/** Symbol kinds, deliberately aligned with the frontend SymbolKind enum. */
export type SymbolKind = 'function' | 'class' | 'const' | 'type' | 'interface'

export interface CodeFile {
  id: number
  /** Repo-relative POSIX path, e.g. "lib/api/client.ts". */
  path: string
  language: Language
  /** Non-blank lines of code. */
  loc: number
  /** Short content hash (deterministic; for cache invalidation + change detection). */
  sha: string
  /** File mtime in ms (used by --watch; not part of ranking). */
  lastModified: number
}

export interface CodeSymbol {
  id: number
  fileId: number
  name: string
  kind: SymbolKind
  /** Single-line, elided declaration signature (no body). */
  signature: string
  /** 1-based inclusive line range of the declaration. */
  startLine: number
  endLine: number
  /** True if the symbol is part of the file's public surface (exported). */
  exported: boolean
}

/**
 * A directed edge. For `import`, source/target are FILE ids (file imports file).
 * For `calls`, source/target are SYMBOL ids (function calls function — heuristic,
 * resolved by name within the same file or an imported file).
 */
export interface CodeEdge {
  id: number
  sourceId: number
  targetId: number
  kind: 'import' | 'calls'
  /** How many import specifiers / call sites back this edge (≥1). */
  weight: number
}

export interface CodeGraph {
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

/** Per-file parse output. */
export interface ParseResult {
  symbols: Omit<CodeSymbol, 'id' | 'fileId'>[]
  imports: RawImport[]
  calls: RawCall[]
}
