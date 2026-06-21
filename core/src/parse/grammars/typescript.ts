import * as path from 'node:path'
import type { GrammarConfig, TsAliases } from './index.js'

const posix = path.posix

const TS_SYMBOLS = `
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(class_declaration name: (type_identifier) @name) @def.class
(abstract_class_declaration name: (type_identifier) @name) @def.class
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.type
(lexical_declaration (variable_declarator name: (identifier) @name)) @def.const
(variable_declaration (variable_declarator name: (identifier) @name)) @def.const
`
const TS_IMPORTS = `
(import_statement source: (string) @source)
(export_statement source: (string) @source)
(call_expression function: (import) arguments: (arguments (string) @source))
`
const TS_CALLS = `
(call_expression function: (identifier) @callee)
(call_expression function: (member_expression property: (property_identifier) @callee))
(new_expression constructor: (identifier) @callee)
`

function exported(def: import('web-tree-sitter').Node): boolean {
  let n: import('web-tree-sitter').Node | null = def
  for (let i = 0; i < 3 && n; i++) {
    if (n.type === 'export_statement') return true
    n = n.parent
  }
  return false
}

function topLevel(def: import('web-tree-sitter').Node): boolean {
  const p = def.parent
  if (!p) return false
  if (p.type === 'program') return true
  if (p.type === 'export_statement' && p.parent?.type === 'program') return true
  return false
}

// ---------------------------------------------------------------------------
// Import resolution
// ---------------------------------------------------------------------------

const TSJS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

function withoutKnownExt(p: string): string {
  const ext = posix.extname(p)
  if (TSJS_EXTS.includes(ext)) return p.slice(0, -ext.length)
  return p
}

function resolveBase(joinedRaw: string, bySet: Set<string>): string | null {
  const joined = posix.normalize(joinedRaw).replace(/^\.\//, '')
  if (joined.startsWith('..')) return null
  const base = withoutKnownExt(joined)
  const candidates: string[] = []
  if (joined !== base) candidates.push(joined)
  for (const ext of TSJS_EXTS) candidates.push(base + ext)
  for (const ext of TSJS_EXTS) candidates.push(posix.join(base, 'index') + ext)
  for (const c of candidates) {
    if (bySet.has(c)) return c
  }
  return null
}

function resolveTsJs(
  fromRel: string,
  spec: string,
  bySet: Set<string>,
  tsAliases?: TsAliases,
): string | null {
  const aliases = tsAliases ?? { baseUrl: '', rules: [], excludes: [] }
  if (spec.startsWith('.')) {
    const fromDir = posix.dirname(fromRel)
    return resolveBase(posix.join(fromDir, spec), bySet)
  }
  const rules = [...aliases.rules].sort((a, b) => b.prefix.length - a.prefix.length)
  for (const rule of rules) {
    let captured: string | null = null
    if (rule.suffix === '\0exact') {
      if (spec === rule.prefix) captured = ''
    } else if (spec.startsWith(rule.prefix) && spec.endsWith(rule.suffix)) {
      captured = spec.slice(rule.prefix.length, spec.length - rule.suffix.length)
    }
    if (captured == null) continue
    for (const target of rule.targets) {
      const filled = target.replace('*', captured)
      const joined = aliases.baseUrl ? posix.join(aliases.baseUrl, filled) : filled
      const hit = resolveBase(joined, bySet)
      if (hit) return hit
    }
  }
  if (aliases.baseUrl) {
    const hit = resolveBase(posix.join(aliases.baseUrl, spec), bySet)
    if (hit) return hit
  }
  return null
}

export const typescript: GrammarConfig = {
  symbolQuery: TS_SYMBOLS,
  importQuery: TS_IMPORTS,
  callQuery: TS_CALLS,
  keep: (def) => topLevel(def) || exported(def),
  exported: (def) => exported(def),
  importSpecifier: (n) => {
    const s = n.text
    if (s.length >= 2) {
      const first = s[0]
      const last = s[s.length - 1]
      if ((first === '"' || first === "'" || first === '`') && last === first) {
        return s.slice(1, -1)
      }
    }
    return s
  },
  resolveImport: resolveTsJs,
}

export const tsx: GrammarConfig = typescript
