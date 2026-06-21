import type { GrammarConfig } from './index.js'

const OCAML_SYMBOLS = `
(let_binding (value_name) @name) @def.const
(class_binding (class_name) @name) @def.class
`
const OCAML_IMPORTS = `
(open_module (module_path (module_name) @mod))
(include_module (module_path (module_name) @mod))
`
const OCAML_CALLS = ``

function resolveOcaml(_fromRel: string, spec: string, bySet: Set<string>): string | null {
  const filePath = spec.replace(/\./g, '/')
  for (const p of bySet) {
    const lowerP = p.toLowerCase()
    const lowerF = filePath.toLowerCase()
    if (lowerP === lowerF + '.ml' || lowerP === lowerF + '.mli') return p
    if (lowerP.replace(/\\/g, '/').includes(spec.toLowerCase())) return p
  }
  return null
}

export const ocaml: GrammarConfig = {
  symbolQuery: OCAML_SYMBOLS,
  importQuery: OCAML_IMPORTS,
  callQuery: OCAML_CALLS,
  keep: (def) => def.parent?.type === 'structure_item',
  exported: () => true,
  importSpecifier: (n) => n.text,
  resolveImport: resolveOcaml,
}
