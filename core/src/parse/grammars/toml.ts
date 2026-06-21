import type { GrammarConfig } from './index.js'

const TOML_SYMBOLS = `
(pair (bare_key) @name) @def.const
(table (bare_key) @name) @def.class
`

export const toml: GrammarConfig = {
  symbolQuery: TOML_SYMBOLS,
  importQuery: null,
  callQuery: undefined,
  keep: () => true,
  exported: () => true,
  importSpecifier: () => '',
  resolveImport: () => null,
}
