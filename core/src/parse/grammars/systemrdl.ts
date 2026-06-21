import type { GrammarConfig } from './index.js'

// SystemRDL: symbols-only (register description language, no import graph)
const RDL_SYMBOLS = ``

export const systemrdl: GrammarConfig = {
  symbolQuery: RDL_SYMBOLS,
  importQuery: null,
  callQuery: undefined,
  keep: () => true,
  exported: () => true,
  importSpecifier: () => '',
  resolveImport: () => null,
}
