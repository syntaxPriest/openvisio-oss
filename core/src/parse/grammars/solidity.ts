import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const SOL_SYMBOLS = `
(contract_declaration (identifier) @name) @def.class
`
const SOL_IMPORTS = `
(import_directive (string) @source)
`
const SOL_CALLS = `
(call_expression (identifier) @callee)
`

function resolveSolidity(fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('/') || spec.startsWith('<')) return null
  const fromDir = posix.dirname(fromRel)
  const joined = posix.normalize(posix.join(fromDir, spec))
  if (joined.startsWith('..')) return null
  if (bySet.has(joined)) return joined
  for (const ext of ['.sol', '']) {
    const c = joined + ext
    if (bySet.has(c)) return c
  }
  return null
}

export const solidity: GrammarConfig = {
  symbolQuery: SOL_SYMBOLS,
  importQuery: SOL_IMPORTS,
  callQuery: SOL_CALLS,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: resolveSolidity,
}
