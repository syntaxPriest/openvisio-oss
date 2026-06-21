import type { GrammarConfig } from './index.js'

const CSS_SYMBOLS = `
(rule_set (selectors (class_selector (class_name) @name))) @def.type
(rule_set (selectors (id_selector (id_name) @name))) @def.type
(rule_set (selectors (tag_name) @name)) @def.type
`

export const css: GrammarConfig = {
  symbolQuery: CSS_SYMBOLS,
  importQuery: null,
  callQuery: undefined,
  keep: () => true,
  exported: () => true,
  importSpecifier: () => '',
  resolveImport: () => null,
}
