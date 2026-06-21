import type { GrammarConfig } from './index.js'

const QL_SYMBOLS = `
(class name: (identifier) @name) @def.class
(predicate name: (identifier) @name) @def.function
(module name: (identifier) @name) @def.class
(select) @def.const
`
const QL_IMPORTS = `
(import_directive module: (module_name) @mod)
`

function resolveQl(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const filePath = spec.replace(/\./g, '/') + '.ql'
  if (bySet.has(filePath)) return filePath
  return null
}

export const ql: GrammarConfig = {
  symbolQuery: QL_SYMBOLS,
  importQuery: QL_IMPORTS,
  callQuery: undefined,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: resolveQl,
}
