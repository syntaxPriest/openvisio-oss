// Content search — the grep replacement. The structural tools (find_symbol,
// get_neighborhood, get_dependents) answer "where is this symbol and how does it
// connect". They can't answer "where does this literal string / regex / TODO /
// error message / config key appear", which is why agents fall back to grep.
//
// This closes that gap WITHOUT leaving the graph: it searches the SAME curated
// file set OpenVisio already indexed (source only — no node_modules, no
// binaries, no lockfiles), reads each file on demand, and returns matches that
// are ranked by containing-file centrality, annotated with the enclosing symbol,
// and carry an exact `path:line` anchor + snippet. Token-budgeted like every
// other view. Deterministic: no LLM, byte-stable ordering.

import { TokenBudget } from './budget.js'
import { computeCentrality, type Centrality } from './rank.js'
import type { ViewResult } from './skeleton.js'
import type { CodeFile, CodeGraph, CodeSymbol } from './types.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Reuse-friendly line cache, keyed by absolute path + mtime so --watch edits
// invalidate naturally (mirrors slice.ts, kept local to avoid coupling).
const fileCache = new Map<string, { mtimeMs: number; lines: string[] }>()
const CACHE_MAX = 200

const NUL = String.fromCharCode(0)

function readLines(absPath: string): string[] | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(absPath)
  } catch {
    return null
  }
  const cached = fileCache.get(absPath)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.lines
  let content: string
  try {
    content = fs.readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
  // Skip anything that looks binary (a NUL byte). The indexed set already
  // excludes known binaries, but this is a cheap belt-and-suspenders guard.
  if (content.includes(NUL)) return null
  const lines = content.split('\n')
  if (fileCache.size >= CACHE_MAX) {
    const first = fileCache.keys().next().value
    if (first !== undefined) fileCache.delete(first)
  }
  fileCache.set(absPath, { mtimeMs: stat.mtimeMs, lines })
  return lines
}

export interface SearchContentOptions {
  /** The search text. Treated as a literal unless `regex` is true. */
  query: string
  /** Interpret `query` as a JS regular expression instead of a literal. */
  regex?: boolean
  /** Case-sensitive match (default false — case-insensitive like ripgrep -i). */
  caseSensitive?: boolean
  /**
   * Restrict to files whose repo-relative path matches this filter. A glob when
   * it contains `*`/`?` (e.g. `*.ts`, `src/api/*`), else a case-insensitive
   * substring (e.g. `components/`, `client`).
   */
  pathFilter?: string
  /** Max matching lines emitted per file before eliding the rest (default 5). */
  maxPerFile?: number
  /** Hard cap on total matching lines collected before budgeting (default 60). */
  limit?: number
  /** Token ceiling for the whole view (default 1500). */
  budgetTokens?: number
  /** Reuse a precomputed centrality (else computed on the fly). */
  centrality?: Centrality
}

/** One matching line, resolved to its file, enclosing symbol, and centrality. */
interface Match {
  file: CodeFile
  line: number
  text: string
  enclosing: CodeSymbol | null
  score: number
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileQuery(opts: SearchContentOptions): RegExp | null {
  const flags = opts.caseSensitive ? 'g' : 'gi'
  const src = opts.regex ? opts.query : escapeRegExp(opts.query)
  try {
    return new RegExp(src, flags)
  } catch {
    return null
  }
}

/** Build a path predicate from `pathFilter`: glob when it has wildcards, else a
 *  case-insensitive substring match. */
function pathMatcher(filter: string | undefined): (p: string) => boolean {
  if (!filter) return () => true
  if (/[*?]/.test(filter)) {
    const rx = escapeRegExp(filter).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')
    let re: RegExp
    try {
      re = new RegExp(rx, 'i')
    } catch {
      return () => true
    }
    return (p) => re.test(p)
  }
  const needle = filter.toLowerCase()
  return (p) => p.toLowerCase().includes(needle)
}

/** Innermost symbol whose 1-based line range contains `line` (smallest span). */
function enclosingSymbol(syms: CodeSymbol[] | undefined, line: number): CodeSymbol | null {
  if (!syms) return null
  let best: CodeSymbol | null = null
  for (const s of syms) {
    if (line < s.startLine || line > s.endLine) continue
    if (!best || s.endLine - s.startLine < best.endLine - best.startLine) best = s
  }
  return best
}

/** A snippet of the matching line, trimmed and capped so one long minified line
 *  can't blow the budget. */
function snippet(text: string, max = 160): string {
  const t = text.replace(/\t/g, '  ').trimEnd()
  if (t.length <= max) return t.trimStart()
  return t.trimStart().slice(0, max) + ' …'
}

/**
 * Search file contents across the indexed repo. Returns a ranked, anchored,
 * token-budgeted view — the deterministic replacement for grep/rg. Matches are
 * grouped by file (most import-central first), each line carrying an
 * `@path:line` anchor and the enclosing symbol so the agent can drill straight
 * in without a whole-file read.
 */
export function searchContent(graph: CodeGraph, opts: SearchContentOptions): ViewResult {
  if (!opts.query) return { text: 'Provide a non-empty `query` to search for.', fileIds: [] }
  const re = compileQuery(opts)
  if (!re) return { text: `Invalid regex: ${opts.query}`, fileIds: [] }

  const centrality = opts.centrality ?? computeCentrality(graph)
  const maxPerFile = opts.maxPerFile ?? 5
  const limit = opts.limit ?? 60
  const matchesPath = pathMatcher(opts.pathFilter)

  // Scan files most-central-first so, when we hit the limit, we keep the matches
  // that matter. Stable tiebreak on path.
  const files = graph.files
    .filter((f) => matchesPath(f.path))
    .sort((a, b) => {
      const sa = centrality.scoreByFile.get(a.id) ?? 0
      const sb = centrality.scoreByFile.get(b.id) ?? 0
      if (sb !== sa) return sb - sa
      return a.path.localeCompare(b.path)
    })

  const byFile = new Map<number, Match[]>()
  let totalMatches = 0
  let filesWithMatches = 0
  let truncated = false

  outer: for (const file of files) {
    const lines = readLines(path.join(graph.rootPath, file.path))
    if (!lines) continue
    const syms = graph.symbolsByFile.get(file.id)
    const score = centrality.scoreByFile.get(file.id) ?? 0
    let fileHits: Match[] | null = null
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      if (!re.test(lines[i]!)) continue
      if (!fileHits) {
        fileHits = []
        byFile.set(file.id, fileHits)
        filesWithMatches++
      }
      fileHits.push({
        file,
        line: i + 1,
        text: lines[i]!,
        enclosing: enclosingSymbol(syms, i + 1),
        score,
      })
      totalMatches++
      if (totalMatches >= limit) {
        truncated = true
        break outer
      }
    }
  }

  const header =
    `# search: ${opts.regex ? `/${opts.query}/` : `"${opts.query}"`}` +
    (opts.pathFilter ? ` in ${opts.pathFilter}` : '') +
    ` — ${totalMatches} match(es) in ${filesWithMatches} file(s)` +
    (truncated ? ` (stopped at ${limit})` : '') +
    '\n'

  if (totalMatches === 0) {
    return {
      text:
        header +
        '\nNo matches. Try a broader pattern, drop `path_filter`, or set `regex: true`. ' +
        'For a symbol by name use find_symbol; for who-calls-what use get_dependents.',
      fileIds: [],
    }
  }

  const budget = new TokenBudget(opts.budgetTokens ?? 1500)
  budget.add(header)
  const out: string[] = []
  const fileIds: number[] = []

  // byFile insertion order already follows centrality (files were pre-sorted).
  for (const [fileId, hits] of byFile) {
    const file = graph.filesById.get(fileId)!
    const fileHeader = `\n${file.path}  (${file.language}) — ${hits.length} hit(s)`
    const firstHit = hits[0]
      ? `\n  ${hits[0].line}: ${snippet(hits[0].text)}  @${file.path}:${hits[0].line}`
      : ''
    if (budget.wouldExceed(fileHeader + firstHit)) {
      out.push(`\n… more matches omitted (budget reached). Narrow with path_filter or raise budget_tokens.`)
      break
    }
    budget.add(fileHeader)
    out.push(fileHeader)
    fileIds.push(fileId)
    let shown = 0
    for (const h of hits) {
      if (shown >= maxPerFile) break
      const where = h.enclosing ? `  (in ${h.enclosing.name})` : ''
      const row = `\n  ${h.line}: ${snippet(h.text)}${where}  @${file.path}:${h.line}`
      if (!budget.tryAdd(row)) break
      out.push(row)
      shown++
    }
    if (shown < hits.length) {
      const more = `\n  … ${hits.length - shown} more in ${file.path}`
      if (budget.tryAdd(more)) out.push(more)
    }
  }

  return { text: header + out.join(''), fileIds }
}
