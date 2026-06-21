// Token-budgeted skeleton serialization. Turns the ranked graph into a compact,
// whole-repo "what is this codebase" view an agent reads ONCE instead of
// crawling files. Rank-ordered, elided to a token budget, every line carrying a
// `path:line` anchor so the agent can fall back to a real read when needed.
//
// This is the Aider-repo-map idea built on OpenVisio's own graph: the most
// import-central files first, each with its public surface (names + signatures).

import { TokenBudget } from './budget.js'
import { computeCentrality, rankByCentrality, type RankedFile } from './rank.js'
import type { CodeGraph, CodeSymbol } from './types.js'

/**
 * A rendered, token-budgeted view plus the file ids it references. `fileIds` is
 * what the savings receipt uses as the file-exploration baseline ("the files the
 * agent would otherwise have read to learn the same").
 */
export interface ViewResult {
  text: string
  fileIds: number[]
}

export interface SkeletonOptions {
  /** Token ceiling for the whole skeleton (default 1500). */
  budgetTokens?: number
  /** Max symbols listed per file before eliding the rest (default 12). */
  maxSymbolsPerFile?: number
  /**
   * Pre-computed ranking (e.g. task-personalized from rankForTask). When
   * omitted, plain structural centrality is used.
   */
  ranking?: RankedFile[]
  /**
   * Append a COMPLETE path inventory of every file not shown in detail — nothing
   * hidden, so the map mirrors the atlas (which shows every node). The detailed,
   * signature-bearing section stays budgeted; the inventory is paths only (cheap)
   * and unbounded. Used by get_repo_skeleton; left off for task-focused tools.
   */
  fullInventory?: boolean
}

/**
 * One symbol line: `signature  @path:line`. The signature already carries the
 * language keyword (`function`/`class`/`interface`/`def`/…), so we don't prefix
 * `sym.kind` — that just duplicated it (`function function foo`). The normalized
 * kind stays in the data model for programmatic tools. A bare `export` marker is
 * added for exported symbols whose signature doesn't already show it.
 */
export function formatSymbol(sym: CodeSymbol, filePath: string): string {
  const sig = sym.signature || sym.name
  const mark = sym.exported && !/^export\b|\bpub\b|\bpublic\b/.test(sig) ? '· ' : '  '
  return `  ${mark}${sig}  @${filePath}:${sym.startLine}`
}

/**
 * Build a ranked, elided, token-budgeted skeleton string. The most central
 * files appear first; within a file, exported symbols come before private ones,
 * then by line. Files are added whole-or-not (header + at least one symbol) so
 * we never emit a misleading half-file, and we stop before the budget is blown.
 */
export function buildSkeleton(graph: CodeGraph, opts: SkeletonOptions = {}): ViewResult {
  const limit = opts.budgetTokens ?? 1500
  const maxSyms = opts.maxSymbolsPerFile ?? 12
  const ranking = opts.ranking ?? rankByCentrality(graph, computeCentrality(graph))
  const budget = new TokenBudget(limit)

  const header = `# ${graph.name} — skeleton (${graph.files.length} files, ${graph.edges.length} import edges)\n`
  const lines: string[] = []
  const fileIds: number[] = []
  budget.add(header)

  let filesShown = 0
  for (const { fileId } of ranking) {
    const file = graph.filesById.get(fileId)
    if (!file) continue
    const syms = [...(graph.symbolsByFile.get(fileId) ?? [])].sort((a, b) => {
      if (a.exported !== b.exported) return a.exported ? -1 : 1
      return a.startLine - b.startLine
    })
    if (syms.length === 0) continue // skip files with no public surface

    const fileHeader = `\n${file.path}  (${file.language}, ${file.loc} loc)`
    // A file's minimum footprint is its header + first symbol; if even that
    // won't fit, we're done (ranking is descending, so nothing later fits more).
    const firstSym = formatSymbol(syms[0]!, file.path)
    if (budget.wouldExceed(fileHeader + '\n' + firstSym)) break

    budget.add(fileHeader)
    lines.push(fileHeader)
    let shown = 0
    let elided = 0
    for (const sym of syms) {
      if (shown >= maxSyms) {
        elided = syms.length - shown
        break
      }
      const line = formatSymbol(sym, file.path)
      if (!budget.tryAdd('\n' + line)) {
        elided = syms.length - shown
        break
      }
      lines.push(line)
      shown++
    }
    if (elided > 0) {
      const more = `  … ${elided} more symbol(s) in ${file.path}`
      if (budget.tryAdd('\n' + more)) lines.push(more)
    }
    fileIds.push(fileId)
    filesShown++
  }

  // Tail: either the complete inventory (every remaining file path — the atlas's
  // "show everything") or a one-line note about what the budget elided.
  let footer = ''
  if (opts.fullInventory) {
    const shownSet = new Set(fileIds)
    const rest = graph.files
      .filter((f) => !shownSet.has(f.id))
      .map((f) => f.path)
      .sort((a, b) => a.localeCompare(b))
    if (rest.length > 0) {
      footer =
        `\n\n# Every other file (${rest.length}) — complete inventory, nothing hidden ` +
        `(paths only; use find_symbol / get_neighborhood for any of them):\n` +
        rest.join('\n')
    }
  } else {
    const omitted = ranking.length - filesShown
    if (omitted > 0) {
      footer = `\n\n… ${omitted} lower-ranked file(s) omitted to fit ${limit}-token budget. Use find_symbol / get_neighborhood to drill in.`
    }
  }

  return { text: header + lines.join('\n') + footer, fileIds }
}
