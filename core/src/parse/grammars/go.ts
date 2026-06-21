import type { GrammarConfig } from './index.js'

const GO_SYMBOLS = `
(function_declaration name: (identifier) @name) @def.function
(method_declaration name: (field_identifier) @name) @def.function
(type_declaration (type_spec name: (type_identifier) @name)) @def.type
`
const GO_IMPORTS = `(import_spec path: (interpreted_string_literal) @source)`
const GO_CALLS = `
(call_expression function: (identifier) @callee)
(call_expression function: (selector_expression field: (field_identifier) @callee))
`

function resolveGo(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const firstSeg = spec.split('/')[0] ?? ''
  if (!firstSeg.includes('.')) return null
  for (const p of bySet) {
    if (p.includes(spec)) return p
  }
  return null
}

export const go: GrammarConfig = {
  symbolQuery: GO_SYMBOLS,
  importQuery: GO_IMPORTS,
  callQuery: GO_CALLS,
  keep: (def) => def.parent?.type === 'source_file',
  exported: (_def, name) => /^[A-Z]/.test(name),
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1)
    return s
  },
  resolveImport: resolveGo,
}
