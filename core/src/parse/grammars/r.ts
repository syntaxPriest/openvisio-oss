import type { GrammarConfig } from './index.js'

const R_SYMBOLS = `
(binary_operator lhs: (identifier) @name rhs: (function_definition) @def) @def.function
`
const R_IMPORTS = `
(call function: (identifier) @fn arguments: (arguments (argument (identifier) @source)))
(call function: (identifier) @fn arguments: (arguments (argument (string) @source)))
`
const R_CALLS = `
(call function: (identifier) @callee)
`

export const rLanguage: GrammarConfig = {
  symbolQuery: R_SYMBOLS,
  importQuery: R_IMPORTS,
  callQuery: R_CALLS,
  keep: (_def, _name) => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: () => null,
}
