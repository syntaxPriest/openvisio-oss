import type { GrammarConfig } from './index.js'

const CS_SYMBOLS = `
(class_declaration (identifier) @name) @def.class
(struct_declaration (identifier) @name) @def.class
(interface_declaration (identifier) @name) @def.interface
(enum_declaration (identifier) @name) @def.type
(delegate_declaration (identifier) @name) @def.function
(method_declaration (identifier) @name) @def.function
(property_declaration (identifier) @name) @def.const
`
const CS_IMPORTS = `
(using_directive (identifier) @ns)
(using_directive (qualified_name) @ns)
`
const CS_CALLS = `
(invocation_expression (member_access_expression (identifier) @callee))
(invocation_expression (identifier) @callee)
`

function resolveCSharp(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const dirPath = spec.replace(/\./g, '/')
  for (const p of bySet) {
    if (p.startsWith(dirPath + '/') || p === dirPath + '.cs') return p
  }
  return null
}

export const csharp: GrammarConfig = {
  symbolQuery: CS_SYMBOLS,
  importQuery: CS_IMPORTS,
  callQuery: CS_CALLS,
  keep: () => true,
  exported: (def) => /\bpublic\b/.test(def.text),
  importSpecifier: (n) => n.text,
  resolveImport: resolveCSharp,
}
