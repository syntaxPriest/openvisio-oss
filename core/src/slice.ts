// Source slicing with elision. The graph stores symbol line ranges but not
// source text (keeping it small + serializable). When a tool needs to show an
// actual definition body, this reads the file on demand and returns a
// token-budgeted slice that ALWAYS carries a `path:line-endLine` anchor, so the
// agent can fall back to a full read when the slice is insufficient.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { estimateTokens } from './budget.js'
import type { CodeGraph, CodeSymbol } from './types.js'

// Small cache so repeated slices into the same file during one tool call (e.g.
// several matching symbols) don't re-read from disk. Keyed by absolute path +
// mtime so --watch edits invalidate naturally.
const fileCache = new Map<string, { mtimeMs: number; lines: string[] }>()
const CACHE_MAX = 50

function setCache(key: string, value: { mtimeMs: number; lines: string[] }): void {
  if (fileCache.size >= CACHE_MAX) {
    const first = fileCache.keys().next().value
    if (first !== undefined) fileCache.delete(first)
  }
  fileCache.set(key, value)
}

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
  const lines = content.split('\n')
  setCache(absPath, { mtimeMs: stat.mtimeMs, lines })
  return lines
}

export interface SliceResult {
  /** `path:startLine-endLine` */
  anchor: string
  /** The (possibly elided) source text. */
  source: string
  /** True if the body was truncated to fit the budget. */
  elided: boolean
}

export interface SliceOptions {
  /** Token ceiling for the emitted source (default 400). */
  budgetTokens?: number
  /** When eliding, how many leading body lines to keep after the signature. */
  headLines?: number
}

/**
 * Return a symbol's source, elided to a token budget. Short bodies are returned
 * whole; long bodies become `signature line … head lines … (N more at anchor)`.
 * Returns null only if the file can't be read (caller should fall back to the
 * stored signature).
 */
export function sliceSymbolSource(
  graph: CodeGraph,
  sym: CodeSymbol,
  opts: SliceOptions = {},
): SliceResult | null {
  const file = graph.filesById.get(sym.fileId)
  if (!file) return null
  const absPath = path.join(graph.rootPath, file.path)
  const lines = readLines(absPath)
  const anchor = `${file.path}:${sym.startLine}-${sym.endLine}`
  if (!lines) return null

  // 1-based inclusive → slice. Guard against stale ranges after edits.
  const start = Math.max(0, sym.startLine - 1)
  const end = Math.min(lines.length, sym.endLine)
  const body = lines.slice(start, end)
  const full = body.join('\n')

  const budget = opts.budgetTokens ?? 400
  if (estimateTokens(full) <= budget) {
    return { anchor, source: full, elided: false }
  }

  // Elide: keep the signature line + a head window, then a pointer to the rest.
  const head = opts.headLines ?? 8
  const kept = body.slice(0, Math.max(1, head))
  const remaining = body.length - kept.length
  const source =
    kept.join('\n') +
    `\n  … ${remaining} more line(s) — read ${file.path}:${sym.startLine}-${sym.endLine}`
  return { anchor, source, elided: true }
}
