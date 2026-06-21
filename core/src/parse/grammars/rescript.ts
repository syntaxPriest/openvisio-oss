import type { GrammarConfig } from './index.js'

const RESCRIPT_SYMBOLS = `
(let_declaration (let_binding (value_identifier) @name)) @def.const
(module_declaration (module_binding (module_identifier) @name)) @def.class
`
const RESCRIPT_IMPORTS = `
(open_statement (module_identifier) @mod)
`
const RESCRIPT_CALLS = ``

export const rescript: GrammarConfig = {
  symbolQuery: RESCRIPT_SYMBOLS,
  importQuery: RESCRIPT_IMPORTS,
  callQuery: RESCRIPT_CALLS,
  keep: (def) => def.parent?.type === 'source_file',
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: () => null, // ReScript module resolution via bsconfig — skip in v1
}
