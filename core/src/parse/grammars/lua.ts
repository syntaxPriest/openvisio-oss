import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const LUA_SYMBOLS = `
(function_definition_statement (identifier) @name) @def.function
`
const LUA_IMPORTS = ``
const LUA_CALLS = ``

function resolveLua(fromRel: string, spec: string, bySet: Set<string>): string | null {
  const pathSpec = spec.replace(/\./g, '/')
  const fromDir = posix.dirname(fromRel)
  const joined = posix.normalize(posix.join(fromDir, pathSpec))
  if (joined.startsWith('..')) return null
  const exts = ['.lua', '']
  for (const ext of exts) {
    const c = joined + ext
    if (bySet.has(c)) return c
  }
  const direct = posix.normalize(posix.join(fromDir, spec))
  if (!direct.startsWith('..')) {
    for (const ext of exts) {
      const c = direct + ext
      if (bySet.has(c)) return c
    }
  }
  return null
}

export const lua: GrammarConfig = {
  symbolQuery: LUA_SYMBOLS,
  importQuery: LUA_IMPORTS,
  callQuery: LUA_CALLS,
  keep: (def) => {
    const p = def.parent?.type
    return p === 'program' || p === 'block' || p === 'chunk'
  },
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: resolveLua,
}
