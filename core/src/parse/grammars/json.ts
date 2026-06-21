import type { GrammarConfig } from './index.js'

// JSON: symbols-only (no import graph, no call edges)
const JSON_SYMBOLS = `
(pair key: (string) @name) @def.const
`

export const json: GrammarConfig = {
  symbolQuery: JSON_SYMBOLS,
  importQuery: null,
  callQuery: undefined,
  keep: (def) => def.parent?.parent?.type === 'object' && def.parent?.parent?.parent?.type === 'document',
  exported: () => true,
  importSpecifier: () => '',
  resolveImport: () => null,
}
