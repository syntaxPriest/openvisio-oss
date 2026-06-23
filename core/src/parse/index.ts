// Per-language symbol + import/call extraction via tree-sitter queries.
// Delegates to parse/grammars/ for per-language config. Deterministic.

import type { Node } from 'web-tree-sitter'
import type { ParseResult, SymbolKind } from '../types.js'
import { getOrCompileQueries, grammarForFile, parseSource } from './treesitter.js'
import { GRAMMARS, type GrammarConfig } from './grammars/index.js'

function kindFromCapture(captureName: string): SymbolKind {
  const k = captureName.slice('def.'.length)
  return (k as SymbolKind) ?? 'const'
}

function signatureOf(def: Node): string {
  const text = def.text
  let end = text.length
  const brace = text.indexOf('{')
  if (brace !== -1) end = Math.min(end, brace)
  const nl = text.indexOf('\n')
  if (nl !== -1) end = Math.min(end, nl)
  const sig = text.slice(0, end).replace(/\s+/g, ' ').trim()
  return sig.length > 200 ? sig.slice(0, 197) + '…' : sig
}

/** Parse one file into its public-surface symbols and raw import specifiers. */
export async function parseFile(relPath: string, content: string): Promise<ParseResult> {
  const grammar = grammarForFile(relPath)
  if (!grammar) return { symbols: [], imports: [], calls: [] }
  const config: GrammarConfig | undefined = GRAMMARS[grammar]
  if (!config) return { symbols: [], imports: [], calls: [] }
  let root
  try {
    root = await parseSource(grammar, content)
  } catch (err) {
    console.error(`[parse] parseSource failed for ${relPath}: ${err instanceof Error ? err.message : String(err)}`)
    return { symbols: [], imports: [], calls: [] }
  }
  const queries = getOrCompileQueries(grammar, config)

  let symbols: ParseResult['symbols'] = []
  try {
    const extracted: ParseResult['symbols'] = []
    const seen = new Set<string>()
    for (const match of queries.symbolQuery.matches(root)) {
      let nameNode: Node | undefined
      let defNode: Node | undefined
      let captureName = ''
      for (const cap of match.captures) {
        if (cap.name === 'name') nameNode = cap.node
        else if (cap.name.startsWith('def.')) {
          defNode = cap.node
          captureName = cap.name
        }
      }
      if (!nameNode || !defNode) continue
      const name = nameNode.text
      if (!config.keep(defNode, name)) continue
      const key = `${name}:${defNode.startPosition.row}`
      if (seen.has(key)) continue
      seen.add(key)
      extracted.push({
        name,
        kind: kindFromCapture(captureName),
        signature: signatureOf(defNode),
        startLine: defNode.startPosition.row + 1,
        endLine: defNode.endPosition.row + 1,
        exported: config.exported(defNode, name),
      })
    }
    extracted.sort((a, b) => a.startLine - b.startLine)
    symbols = extracted
  } catch (e) { console.error(`[parse] symbol query failed for ${relPath}: ${e}`) }

  let imports: ParseResult['imports'] = []
  try {
    if (queries.importQuery) {
      const extracted: ParseResult['imports'] = []
      const specSeen = new Set<string>()
      for (const match of queries.importQuery.matches(root)) {
        for (const cap of match.captures) {
          const spec = config.importSpecifier(cap.node).trim()
          if (spec.length > 0 && !specSeen.has(spec)) {
            specSeen.add(spec)
            extracted.push({ specifier: spec })
          }
        }
      }
      imports = extracted
    }
  } catch (e) { console.error(`[parse] import query failed for ${relPath}: ${e}`) }

  let calls: ParseResult['calls'] = []
  try {
    if (queries.callQuery) {
      const extracted: ParseResult['calls'] = []
      for (const match of queries.callQuery.matches(root)) {
        for (const cap of match.captures) {
          if (cap.name !== 'callee') continue
          const callee = cap.node.text
          if (callee.length > 0) extracted.push({ callee, line: cap.node.startPosition.row + 1 })
        }
      }
      calls = extracted
    }
  } catch (e) { console.error(`[parse] call query failed for ${relPath}: ${e}`) }

  return { symbols, imports, calls }
}
