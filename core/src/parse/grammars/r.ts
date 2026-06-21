import type { GrammarConfig } from './index.js'

const R_SYMBOLS = `
(function_definition name: (identifier) @name) @def.function
(assignment name: (identifier) @name) @def.const
`
const R_IMPORTS = `
(call function: (identifier) @fn arguments: (arguments (string) @source))
`
const R_CALLS = `
(call function: (identifier) @callee)
`

export const rLanguage: GrammarConfig = {
  symbolQuery: R_SYMBOLS,
  importQuery: R_IMPORTS,
  callQuery: R_CALLS,
  keep: (def) => def.parent?.type === 'program' || def.parent?.type === 'brace_list',
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: () => null, // R source/library resolution is limited
}
