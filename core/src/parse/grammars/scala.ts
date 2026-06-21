import type { GrammarConfig } from './index.js'

const SCALA_SYMBOLS = `
(class_definition (identifier) @name) @def.class
(trait_definition (identifier) @name) @def.interface
(object_definition (identifier) @name) @def.class
(function_definition (identifier) @name) @def.function
`
const SCALA_IMPORTS = `
(import_declaration (stable_identifier) @path)
`
const SCALA_CALLS = `
(call_expression (identifier) @callee)
`

function resolveScala(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const filePath = spec.replace(/\./g, '/') + '.scala'
  if (bySet.has(filePath)) return filePath
  const dirPath = spec.replace(/\./g, '/')
  for (const p of bySet) {
    if (p.startsWith(dirPath + '/')) return p
  }
  return null
}

export const scala: GrammarConfig = {
  symbolQuery: SCALA_SYMBOLS,
  importQuery: SCALA_IMPORTS,
  callQuery: SCALA_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: resolveScala,
}
