import * as path from 'node:path'
import type { GrammarConfig } from './index.js'

const posix = path.posix

const BASH_SYMBOLS = `
(function_definition name: (word) @name) @def.function
(variable_assignment name: (variable_name) @name) @def.const
`
const BASH_IMPORTS = `
(command name: (command_name) @cmd argument: (string) @source)
`
const BASH_CALLS = `
(command name: (command_name) @callee)
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

function resolveBash(fromRel: string, spec: string, bySet: Set<string>): string | null {
  const exts = ['.sh', '.bash', '']
  return resolveQuotedInclude(fromRel, spec, bySet, exts)
}

export const bash: GrammarConfig = {
  symbolQuery: BASH_SYMBOLS,
  importQuery: BASH_IMPORTS,
  callQuery: BASH_CALLS,
  keep: (def) => def.parent?.type === 'program',
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: resolveBash,
}
