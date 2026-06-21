import type { GrammarConfig } from './index.js'

// HTML: symbols-only (no import graph, no call edges)
const HTML_SYMBOLS = `
; No meaningful top-level symbols in HTML — skip symbol extraction.
`

export const html: GrammarConfig = {
  symbolQuery: HTML_SYMBOLS,
  importQuery: null,
  callQuery: undefined,
  keep: () => false,
  exported: () => false,
  importSpecifier: () => '',
  resolveImport: () => null,
}
