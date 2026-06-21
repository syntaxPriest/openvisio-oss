import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const PHP_SYMBOLS = `
(function_definition name: (name) @name) @def.function
(class_declaration name: (name) @name) @def.class
(interface_declaration name: (name) @name) @def.interface
(trait_declaration name: (name) @name) @def.class
(enum_declaration name: (name) @name) @def.type
(method_declaration name: (name) @name) @def.function
(const_declaration (const_element (name) @name)) @def.const
`
const PHP_IMPORTS = `
(namespace_use_clause (qualified_name) @path)
(include_expression (string) @source)
(include_once_expression (string) @source)
(require_expression (string) @source)
(require_once_expression (string) @source)
`
const PHP_CALLS = `
(function_call_expression function: (qualified_name (name) @callee))
(member_call_expression (name) @callee)
(scoped_call_expression (name) @callee)
`

function resolvePhp(fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('/') || spec.startsWith('\\') || !spec.includes('/')) return null
  const fromDir = posix.dirname(fromRel)
  const joined = posix.normalize(posix.join(fromDir, spec))
  if (joined.startsWith('..')) return null
  const exts = ['.php', '.inc', '']
  for (const ext of exts) {
    const c = joined + ext
    if (bySet.has(c)) return c
  }
  return null
}

export const php: GrammarConfig = {
  symbolQuery: PHP_SYMBOLS,
  importQuery: PHP_IMPORTS,
  callQuery: PHP_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: resolvePhp,
}
