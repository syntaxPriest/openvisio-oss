import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const OBJC_SYMBOLS = `
(class_interface (identifier) @name) @def.class
(class_interface (identifier) @name) @def.class
(method_declaration (method_type (type_name (primitive_type) @name))) @def.function
`
const OBJC_IMPORTS = `
(preproc_include (system_lib_string) @source)
(preproc_include (string_literal) @source)
`
const OBJC_CALLS = ``

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

function resolveObjc(fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('<') || spec.endsWith('>')) return null
  const exts = ['.h', '.m', '.mm']
  return resolveQuotedInclude(fromRel, spec, bySet, exts)
}

export const objc: GrammarConfig = {
  symbolQuery: OBJC_SYMBOLS,
  importQuery: OBJC_IMPORTS,
  callQuery: OBJC_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === '<') && (s[s.length - 1] === '"' || s[s.length - 1] === '>')) {
      return s.slice(1, -1)
    }
    return s
  },
  resolveImport: resolveObjc,
}
