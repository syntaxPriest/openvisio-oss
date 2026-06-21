import type { GrammarConfig } from './index.js'

const VUE_SYMBOLS = ``
const VUE_IMPORTS = ``

export const vue: GrammarConfig = {
  symbolQuery: VUE_SYMBOLS,
  importQuery: VUE_IMPORTS,
  callQuery: undefined,
  keep: () => true,
  exported: () => true,
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'" || s[0] === '`') && s[s.length - 1] === s[0]) return s.slice(1, -1)
    return s
  },
  resolveImport: () => null, // Vue script imports are TS/JS — resolved by the TS/JS parser
}
