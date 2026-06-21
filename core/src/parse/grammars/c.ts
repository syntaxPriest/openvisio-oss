import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const C_SYMBOLS = `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def.function
(struct_specifier name: (type_identifier) @name) @def.class
(union_specifier name: (type_identifier) @name) @def.type
(enum_specifier name: (type_identifier) @name) @def.type
(declaration (type_definition type: (type_identifier) @name)) @def.type
(declaration declarator: (init_declarator declarator: (identifier) @name)) @def.const
`
const C_IMPORTS = `
(preproc_include path: (string_literal) @source)
(preproc_include path: (system_lib_string) @source)
`
const C_CALLS = `
(call_expression function: (identifier) @callee)
(call_expression function: (field_expression field: (field_identifier) @callee))
`

function resolveQuotedInclude(fromRel: string, spec: string, bySet: Set<string>, exts: string[]): string | null {
  if (spec.startsWith('/') || spec.startsWith('<')) return null
  const fromDir = posix.dirname(fromRel)
  const joined = posix.normalize(posix.join(fromDir, spec))
  if (joined.startsWith('..')) return null
  if (bySet.has(joined)) return joined
  for (const ext of exts) {
    const candidate = joined + ext
    if (bySet.has(candidate)) return candidate
  }
  return null
}

function resolveCInclude(fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('<') || spec.endsWith('>')) return null
  const exts = ['.h', '.c', '.cpp', '.cc', '.cxx', '.hpp', '.hh']
  return resolveQuotedInclude(fromRel, spec, bySet, exts)
}

export const c: GrammarConfig = {
  symbolQuery: C_SYMBOLS,
  importQuery: C_IMPORTS,
  callQuery: C_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === '<') && (s[s.length - 1] === '"' || s[s.length - 1] === '>')) {
      return s.slice(1, -1)
    }
    return s
  },
  resolveImport: resolveCInclude,
}
