import type { GrammarConfig } from './index.js'

const ELM_SYMBOLS = `
(function_declaration left: (lower_case_identifier) @name) @def.function
(type_declaration left: (upper_case_identifier) @name) @def.type
(type_alias left: (upper_case_identifier) @name) @def.type
`
const ELM_IMPORTS = `
(import_clause module: (upper_case_qualified_identifier) @mod)
`
const ELM_CALLS = `
(value_expr (value_qualified_identifier (upper_case_identifier) @callee))
(value_expr (value_qualified_identifier (lower_case_identifier) @callee))
`

function resolveElm(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const filePath = spec.replace(/\./g, '/') + '.elm'
  if (bySet.has(filePath)) return filePath
  const lower = filePath.toLowerCase()
  for (const p of bySet) {
    if (p.toLowerCase() === lower) return p
  }
  return null
}

export const elm: GrammarConfig = {
  symbolQuery: ELM_SYMBOLS,
  importQuery: ELM_IMPORTS,
  callQuery: ELM_CALLS,
  keep: (def) => def.parent?.type === 'file',
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: resolveElm,
}
