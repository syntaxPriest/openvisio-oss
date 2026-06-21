import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const ELISP_SYMBOLS = `
(function_definition (symbol) @name) @def.function
(special_form (symbol) @name) @def.const
`
const ELISP_IMPORTS = ``
const ELISP_CALLS = ``

function resolveElisp(fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('/') || spec.startsWith('<')) return null
  const fromDir = posix.dirname(fromRel)
  const joined = posix.normalize(posix.join(fromDir, spec))
  if (joined.startsWith('..')) return null
  if (bySet.has(joined)) return joined
  const exts = ['.el', '']
  for (const ext of exts) {
    const candidate = joined + ext
    if (bySet.has(candidate)) return candidate
  }
  return null
}

export const elisp: GrammarConfig = {
  symbolQuery: ELISP_SYMBOLS,
  importQuery: ELISP_IMPORTS,
  callQuery: ELISP_CALLS,
  keep: (def) => def.parent?.type === 'list' || def.parent?.type === 'source_file',
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1)
    return s
  },
  resolveImport: resolveElisp,
}
