import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const ZIG_SYMBOLS = `
(function_declaration (identifier) @name) @def.function
(variable_declaration (identifier) @name) @def.const
`
const ZIG_IMPORTS = `
(builtin_function (builtin_identifier) @fn (arguments (string) @source))
`
const ZIG_CALLS = `
(call_expression (identifier) @callee)
(call_expression (field_expression (identifier) @callee))
`

function resolveZig(fromRel: string, spec: string, bySet: Set<string>): string | null {
  const fromDir = posix.dirname(fromRel)
  const joined = posix.normalize(posix.join(fromDir, spec))
  if (joined.startsWith('..')) return null
  const exts = ['.zig', '']
  for (const ext of exts) {
    const c = joined + ext
    if (bySet.has(c)) return c
  }
  return null
}

export const zig: GrammarConfig = {
  symbolQuery: ZIG_SYMBOLS,
  importQuery: ZIG_IMPORTS,
  callQuery: ZIG_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1)
    return s
  },
  resolveImport: resolveZig,
}
