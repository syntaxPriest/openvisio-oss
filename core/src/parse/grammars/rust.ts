import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const RS_SYMBOLS = `
(function_item name: (identifier) @name) @def.function
(struct_item name: (type_identifier) @name) @def.class
(enum_item name: (type_identifier) @name) @def.type
(trait_item name: (type_identifier) @name) @def.interface
(const_item name: (identifier) @name) @def.const
`
const RS_IMPORTS = `
(use_declaration (scoped_identifier) @path)
(use_declaration (identifier) @path)
`
const RS_CALLS = `
(call_expression function: (identifier) @callee)
(call_expression function: (scoped_identifier name: (identifier) @callee))
(call_expression function: (field_expression field: (field_identifier) @callee))
`

function resolveRust(fromRel: string, spec: string, bySet: Set<string>): string | null {
  let clean = spec
  if (clean.startsWith('crate::')) clean = clean.slice(7)
  else if (clean.startsWith('self::')) clean = clean.slice(6)
  while (clean.startsWith('super::')) clean = clean.slice(7)
  const filePath = clean.replace(/::/g, '/')
  const fromDir = posix.dirname(fromRel)
  const exts = ['.rs', '/mod.rs', '/index.rs']
  const joined = posix.normalize(posix.join(fromDir, filePath))
  if (!joined.startsWith('..')) {
    for (const ext of exts) {
      const c = joined + ext
      if (bySet.has(c)) return c
    }
  }
  for (const ext of exts) {
    const c = filePath + ext
    if (bySet.has(c)) return c
  }
  return null
}

export const rust: GrammarConfig = {
  symbolQuery: RS_SYMBOLS,
  importQuery: RS_IMPORTS,
  callQuery: RS_CALLS,
  keep: (def) => {
    const p = def.parent?.type
    return p === 'source_file' || p === 'declaration_list' || def.text.trimStart().startsWith('pub')
  },
  exported: (def) => def.text.trimStart().startsWith('pub'),
  importSpecifier: (n) => n.text,
  resolveImport: resolveRust,
}
