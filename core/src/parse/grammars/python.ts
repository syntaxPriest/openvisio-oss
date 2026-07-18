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
// `class Foo(Base, mixins.Other):` — base classes live in the superclasses
// argument list. Captured as `extends` (Python has no separate implements).
const PY_INHERIT = `
(class_definition superclasses: (argument_list (identifier) @extends))
(class_definition superclasses: (argument_list (attribute attribute: (identifier) @extends)))
`

/** True when `def` is a method: a function_definition whose nearest block parent
 *  is the body of a class_definition. */
function isMethod(def: import('web-tree-sitter').Node): boolean {
  const block = def.parent
  if (!block || block.type !== 'block') return false
  return block.parent?.type === 'class_definition'
}

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
  inheritQuery: PY_INHERIT,
  // Keep top-level defs and class methods (build promotes methods' kind by
  // containment). Methods of underscore-private classes still count as members.
  keep: (def) => def.parent?.type === 'module' || isMethod(def),
  // Public surface: a top-level non-underscore name, or a non-underscore method.
  exported: (def, name) =>
    (def.parent?.type === 'module' || isMethod(def)) && !name.startsWith('_'),
  importSpecifier: (n) => n.text,
  resolveImport: resolvePython,
}
