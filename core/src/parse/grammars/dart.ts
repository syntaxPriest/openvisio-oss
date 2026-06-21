import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const DART_SYMBOLS = `
(class_definition (identifier) @name) @def.class
(function_signature (identifier) @name) @def.function
`
const DART_IMPORTS = `
(library_import (import_specification (configurable_uri (uri (string_literal) @source))))
(library_export (configurable_uri (uri (string_literal) @source)))
`
const DART_CALLS = ``

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

function resolveDart(fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('package:')) {
    const rest = spec.slice(8)
    const segs = rest.split('/')
    if (segs.length > 1) {
      const pathInPkg = segs.slice(1).join('/')
      if (bySet.has(pathInPkg)) return pathInPkg
    }
    return null
  }
  const exts = ['.dart', '']
  return resolveQuotedInclude(fromRel, spec, bySet, exts)
}

export const dart: GrammarConfig = {
  symbolQuery: DART_SYMBOLS,
  importQuery: DART_IMPORTS,
  callQuery: DART_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: resolveDart,
}
