import type { GrammarConfig } from './index.js'

const TLA_SYMBOLS = ``
const TLA_IMPORTS = ``

function resolveTlaplus(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  if (spec.startsWith('TLC')) return null
  const filePath = spec + '.tla'
  if (bySet.has(filePath)) return filePath
  return null
}

export const tlaplus: GrammarConfig = {
  symbolQuery: TLA_SYMBOLS,
  importQuery: TLA_IMPORTS,
  callQuery: undefined,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: resolveTlaplus,
}
