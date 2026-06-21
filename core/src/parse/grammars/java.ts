import type { GrammarConfig } from './index.js'

const JAVA_SYMBOLS = `
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(enum_declaration name: (identifier) @name) @def.type
(method_declaration name: (identifier) @name) @def.function
`
const JAVA_IMPORTS = `
(import_declaration (scoped_identifier) @path)
`
const JAVA_CALLS = `
(method_invocation name: (identifier) @callee)
(method_invocation object: (identifier) (identifier) @callee)
`

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

function resolveJava(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const filePath = spec.replace(/\./g, '/') + '.java'
  if (bySet.has(filePath)) return filePath
  const dirPath = spec.replace(/\./g, '/')
  for (const p of bySet) {
    if (p.startsWith(dirPath + '/') || p === dirPath + '.java') return p
  }
  return null
}

export const java: GrammarConfig = {
  symbolQuery: JAVA_SYMBOLS,
  importQuery: JAVA_IMPORTS,
  callQuery: JAVA_CALLS,
  keep: () => true,
  exported: (def) => /\bpublic\b/.test(firstLine(def.text)),
  importSpecifier: (n) => n.text,
  resolveImport: resolveJava,
}
