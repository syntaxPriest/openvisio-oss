import type { GrammarConfig } from './index.js'

const ELIXIR_SYMBOLS = `
(call (identifier) @name) @def.function
`
const ELIXIR_IMPORTS = ``
const ELIXIR_CALLS = `
(call target: (identifier) @callee)
`

function resolveElixir(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const filePath = spec.replace(/\./g, '/').replace(/^Elixir\./, '')
  for (const p of bySet) {
    const lowerP = p.toLowerCase().replace(/\\/g, '/')
    const lowerF = filePath.toLowerCase()
    if (lowerP.includes(lowerF) || lowerP === lowerF + '.ex' || lowerP === lowerF + '.exs') return p
  }
  return null
}

export const elixir: GrammarConfig = {
  symbolQuery: ELIXIR_SYMBOLS,
  importQuery: ELIXIR_IMPORTS,
  callQuery: ELIXIR_CALLS,
  keep: (def) => def.parent?.type === 'source_file' || def.parent?.type === 'block',
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: resolveElixir,
}
