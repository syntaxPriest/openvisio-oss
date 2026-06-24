// In-browser indexer. Takes an in-memory file list ({path, content}) and
// produces the viewer's GraphResponse — no server, no clone. Reuses @openvisio/
// core's actual grammar configs (all ~37 languages: queries + keep/exported/
// importSpecifier/resolveImport) via the browser-safe `@openvisio/core/browser`
// entry; only the I/O is browser-flavoured (fetch wasm + in-memory files). The
// per-file parse loop mirrors core's parseFile so output matches the CLI engine.

import { GRAMMARS, grammarIdFromPath, type GrammarId } from '@openvisio/core/browser'
import { loadGrammar, parse, getQueries } from './treesitter'
import type { Node } from 'web-tree-sitter'
import type { GraphResponse, Language } from '@/lib/api/types'

export interface InputFile {
  path: string // repo-relative POSIX
  content: string
}

// Heavy grammar disabled in the engine too (large wasm). Its files become plain
// nodes without parsed symbols.
const DISABLED = new Set<GrammarId>(['swift'])

// grammar id → display language (most are identity; these two differ).
const GRAMMAR_LANG: Partial<Record<GrammarId, Language>> = { tsx: 'typescript', c_sharp: 'csharp' }
// Light language labels for common non-parsed files, so they still read sensibly.
const EXT_LANG: Record<string, Language> = {
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown', mdx: 'markdown',
  html: 'html', htm: 'html', css: 'css', vue: 'vue',
}
const extOf = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase()
const countLoc = (s: string) => s.split('\n').filter((l) => l.trim().length > 0).length

function languageOf(path: string, grammar: GrammarId | null): Language {
  if (grammar) return GRAMMAR_LANG[grammar] ?? (grammar as Language)
  return EXT_LANG[extOf(path)] ?? 'other'
}

// Mirror of core/parse/index.ts signatureOf — single-line elided declaration.
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

interface ParsedSymbol { name: string; kind: string; signature: string; startLine: number; endLine: number; exported: boolean }
interface ParsedFile {
  id: number
  path: string
  language: Language
  grammar: GrammarId | null
  loc: number
  symbols: ParsedSymbol[]
  imports: string[]
}

/** Parse one file → symbols + import specifiers. Mirrors core's parseFile. */
async function parseOne(id: number, file: InputFile): Promise<ParsedFile> {
  const grammar = grammarIdFromPath(file.path)
  const pf: ParsedFile = { id, path: file.path, language: languageOf(file.path, grammar), grammar, loc: countLoc(file.content), symbols: [], imports: [] }
  if (!grammar || DISABLED.has(grammar)) return pf
  const config = GRAMMARS[grammar]
  if (!config) return pf
  await loadGrammar(grammar)
  let root: Node
  try { root = parse(grammar, file.content) } catch { return pf }

  const q = getQueries(grammar, config)
  const seen = new Set<string>()
  for (const match of q.symbolQuery.matches(root)) {
    let nameNode: Node | undefined, defNode: Node | undefined, captureName = ''
    for (const cap of match.captures) {
      if (cap.name === 'name') nameNode = cap.node
      else if (cap.name.startsWith('def.')) { defNode = cap.node; captureName = cap.name }
    }
    if (!nameNode || !defNode) continue
    const name = nameNode.text
    if (!config.keep(defNode, name)) continue
    const key = `${name}:${defNode.startPosition.row}`
    if (seen.has(key)) continue
    seen.add(key)
    pf.symbols.push({
      name,
      kind: captureName.slice('def.'.length),
      signature: signatureOf(defNode),
      startLine: defNode.startPosition.row + 1,
      endLine: defNode.endPosition.row + 1,
      exported: config.exported(defNode, name),
    })
  }
  pf.symbols.sort((a, b) => a.startLine - b.startLine)

  if (q.importQuery) {
    const specSeen = new Set<string>()
    for (const match of q.importQuery.matches(root)) {
      for (const cap of match.captures) {
        const spec = config.importSpecifier(cap.node).trim()
        if (spec.length > 0 && !specSeen.has(spec)) { specSeen.add(spec); pf.imports.push(spec) }
      }
    }
  }
  return pf
}

/** Index an in-memory file set → GraphResponse for the viewer. */
export async function indexFiles(files: InputFile[], repoName = 'repo'): Promise<GraphResponse> {
  // Pre-load the grammars present so parse calls are ready (and fetched once).
  const needed = new Set<GrammarId>()
  for (const f of files) { const g = grammarIdFromPath(f.path); if (g && !DISABLED.has(g)) needed.add(g) }
  await Promise.all([...needed].map((g) => loadGrammar(g).catch((e) => console.warn('[indexer] grammar', g, 'failed', e))))

  const parsed: ParsedFile[] = []
  let id = 0
  for (const f of files) { parsed.push(await parseOne(id, f)); id++ }

  // Build the viewer GraphResponse. Import edges use each grammar's own
  // resolveImport against the set of repo-relative paths.
  const byPath = new Map<string, number>()
  const bySet = new Set<string>()
  for (const pf of parsed) { byPath.set(pf.path, pf.id); bySet.add(pf.path) }

  const symbols: GraphResponse['symbols'] = []
  let sid = 0
  for (const pf of parsed) for (const s of pf.symbols) {
    symbols.push({ id: sid++, file_id: pf.id, name: s.name, kind: s.kind as GraphResponse['symbols'][number]['kind'], start_line: s.startLine, end_line: s.endLine, is_exported: s.exported })
  }

  const edges: GraphResponse['edges'] = []
  let eid = 0
  for (const pf of parsed) {
    if (!pf.grammar) continue
    const config = GRAMMARS[pf.grammar]
    if (!config) continue
    const targets = new Map<number, number>() // targetId → weight (dedup multi-imports)
    for (const spec of pf.imports) {
      let resolved: string | null = null
      try { resolved = config.resolveImport(pf.path, spec, bySet) } catch { resolved = null }
      if (!resolved) continue
      const target = byPath.get(resolved)
      if (target == null || target === pf.id) continue
      targets.set(target, (targets.get(target) ?? 0) + 1)
    }
    for (const [target, weight] of targets) {
      edges.push({ id: eid++, source_id: pf.id, target_id: target, source_kind: 'file', target_kind: 'file', edge_kind: 'import', weight })
    }
  }

  const langCounts = new Map<Language, number>()
  let totalLoc = 0
  for (const pf of parsed) { langCounts.set(pf.language, (langCounts.get(pf.language) ?? 0) + 1); totalLoc += pf.loc }

  return {
    repo: {
      repo_id: 'browser-' + repoName,
      name: repoName,
      root_path: repoName,
      file_count: parsed.length,
      total_loc: totalLoc,
      languages: [...langCounts.entries()].sort((a, b) => b[1] - a[1]).map(([language, file_count]) => ({ language, file_count })),
      indexed_at: 0,
    },
    files: parsed.map((pf) => ({ id: pf.id, repo_id: 'browser-' + repoName, path: pf.path, language: pf.language, loc: pf.loc, sha: '', last_modified: 0 })),
    symbols,
    edges,
    history: [],
    coupling: [],
  }
}
