import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const RB_SYMBOLS = `
(method name: (identifier) @name) @def.function
(class name: (constant) @name) @def.class
(module name: (constant) @name) @def.class
(singleton_method name: (identifier) @name) @def.function
`
const RB_IMPORTS = `
(call method: (identifier) @method arguments: (argument_list (string) @path))
`
const RB_CALLS = `
(call method: (identifier) @callee)
`

function resolveRuby(fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('/')) return null
  const fromDir = posix.dirname(fromRel)
  const joined = posix.normalize(posix.join(fromDir, spec))
  if (joined.startsWith('..')) return null
  const exts = ['.rb', '']
  for (const ext of exts) {
    const c = joined + ext
    if (bySet.has(c)) return c
  }
  return null
}

export const ruby: GrammarConfig = {
  symbolQuery: RB_SYMBOLS,
  importQuery: RB_IMPORTS,
  callQuery: RB_CALLS,
  keep: (def) => {
    const p = def.parent?.type
    return p === 'program' || p === 'begin' || p === 'module' || p === 'class'
  },
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2) {
      const first = s[0]
      const last = s[s.length - 1]
      if ((first === '"' || first === "'") && last === first) return s.slice(1, -1)
    }
    return s
  },
  resolveImport: resolveRuby,
}
