import type { GrammarConfig } from './index.js'

const SWIFT_SYMBOLS = `
(function_declaration (simple_identifier) @name) @def.function
(class_declaration (type_identifier) @name) @def.class
(protocol_declaration (type_identifier) @name) @def.interface
`
const SWIFT_IMPORTS = `(import_declaration (identifier) @mod)`
const SWIFT_CALLS = `
(call_expression (simple_identifier) @callee)
(call_expression (navigation_expression (simple_identifier) @callee))
`

function resolveSwift(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const stdlib = new Set(['Foundation', 'UIKit', 'SwiftUI', 'AppKit', 'CoreData', 'Dispatch', 'Combine'])
  if (stdlib.has(spec)) return null
  const dirPath = spec.replace(/\./g, '/')
  for (const p of bySet) {
    if (p.includes(dirPath) && p.endsWith('.swift')) return p
  }
  return null
}

export const swift: GrammarConfig = {
  symbolQuery: SWIFT_SYMBOLS,
  importQuery: SWIFT_IMPORTS,
  callQuery: SWIFT_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: resolveSwift,
}
