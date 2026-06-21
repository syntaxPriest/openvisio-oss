import type { GrammarConfig } from './index.js'

// ERB/EJS templates: symbols-only (no meaningful import graph)
const ET_SYMBOLS = `
; No meaningful top-level symbols in embedded templates — skip.
`

export const embedded_template: GrammarConfig = {
  symbolQuery: ET_SYMBOLS,
  importQuery: null,
  callQuery: undefined,
  keep: () => false,
  exported: () => false,
  importSpecifier: () => '',
  resolveImport: () => null,
}
