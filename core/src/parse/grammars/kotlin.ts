import type { GrammarConfig } from './index.js'

const KT_SYMBOLS = `
(class_declaration (type_identifier) @name) @def.class
(object_declaration (type_identifier) @name) @def.class
(function_declaration (simple_identifier) @name) @def.function
(property_declaration (variable_declaration (simple_identifier) @name)) @def.const
(type_alias (type_identifier) @name) @def.type
`
const KT_IMPORTS = `
(import_header (identifier) @path)
`
const KT_CALLS = `
(call_expression (simple_identifier) @callee)
(call_expression (navigation_expression (simple_identifier) @callee))
`

function resolveKotlin(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const filePath = spec.replace(/\./g, '/') + '.kt'
  if (bySet.has(filePath)) return filePath
  const dirPath = spec.replace(/\./g, '/')
  for (const p of bySet) {
    if (p.startsWith(dirPath + '/')) return p
  }
  return null
}

export const kotlin: GrammarConfig = {
  symbolQuery: KT_SYMBOLS,
  importQuery: KT_IMPORTS,
  callQuery: KT_CALLS,
  keep: () => true,
  exported: (def) => /\bpublic\b/.test(def.text),
  importSpecifier: (n) => n.text,
  resolveImport: resolveKotlin,
}
