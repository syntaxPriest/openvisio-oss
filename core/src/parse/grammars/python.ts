import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const PY_SYMBOLS = `
(function_definition name: (identifier) @name) @def.function
(class_definition name: (identifier) @name) @def.class
`
const PY_IMPORTS = `
(import_statement name: (dotted_name) @mod)
(import_statement name: (aliased_import (dotted_name) @mod))
(import_from_statement module_name: (dotted_name) @mod)
(import_from_statement module_name: (relative_import) @mod)
`
const PY_CALLS = `
(call function: (identifier) @callee)
(call function: (attribute attribute: (identifier) @callee))
`

function resolvePython(fromRel: string, spec: string, bySet: Set<string>): string | null {
  const trimmed = spec.trim()
  let dots = 0
  while (dots < trimmed.length && trimmed[dots] === '.') dots++
  const rest = trimmed.slice(dots)
  const restPath = rest.replace(/\./g, '/')

  const tryPath = (dir: string): string | null => {
    const base = restPath ? posix.normalize(posix.join(dir, restPath)) : dir
    const mod = base + '.py'
    if (bySet.has(mod)) return mod
    const pkg = posix.join(base, '__init__.py')
    if (bySet.has(pkg)) return pkg
    return null
  }

  if (dots === 0) return tryPath('')
  let dir = posix.dirname(fromRel)
  for (let i = 1; i < dots; i++) dir = posix.dirname(dir)
  if (dir === '.') dir = ''
  return tryPath(dir)
}

export const python: GrammarConfig = {
  symbolQuery: PY_SYMBOLS,
  importQuery: PY_IMPORTS,
  callQuery: PY_CALLS,
  keep: () => true,
  exported: (def, name) => def.parent?.type === 'module' && !name.startsWith('_'),
  importSpecifier: (n) => n.text,
  resolveImport: resolvePython,
}
