// Browser-safe surface of @openvisio/core. The engine's parse layer is pure
// (tree-sitter queries + per-language resolution logic) — only the scanner,
// graph builder, and wasm *loader* touch Node I/O. This entry re-exports just
// the fs-free pieces, so a browser bundle (the in-browser GitHub indexer) reuses
// the EXACT grammar definitions + import resolution the CLI uses, with no Node
// dependencies dragged in.
//
// What it deliberately does NOT export: scan.ts, build.ts, treesitter.ts,
// store/* (all import node:fs / node:module). The browser provides its own
// in-memory scan + a fetch-based wasm loader instead.

export { GRAMMARS, type GrammarConfig, type TsAliases } from './parse/grammars/index.js'
export { EXT_TO_GRAMMAR, grammarIdFromPath } from './parse/extensions.js'
export type { GrammarId } from './parse/treesitter.js'
export type { Language, SymbolKind, ParseResult } from './types.js'
