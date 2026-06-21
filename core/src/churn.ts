// Git churn + hotspots. "Where's the load-bearing / risky code" = high import
// centrality AND recently changed. Churn is read from LOCAL git history only
// (no network); when the repo isn't a git checkout, hotspots degrade gracefully
// to pure centrality. Centrality is deterministic; churn is time-windowed by
// nature (documented), so hotspot order can shift day-to-day as history moves.

import { execFileSync } from 'node:child_process'
import { TokenBudget } from './budget.js'
import { computeCentrality, type Centrality } from './rank.js'
import type { CodeGraph } from './types.js'
import type { ViewResult } from './skeleton.js'

// Half-saturation point for churn scoring: a file needs this many commits to
// reach a churn score of 0.5. Keeps small-count noise from dominating centrality.
const CHURN_SATURATION = 5

export interface ChurnOptions {
  /** Commit window in days (default 90). */
  windowDays?: number
}

function git(rootPath: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', rootPath, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/**
 * Commit counts per repo-relative file path over a recent window. Returns an
 * empty map when git is unavailable or the path isn't a checkout. Paths are
 * mapped from git-root-relative back to rootPath-relative so they line up with
 * the graph's file paths.
 */
export function computeChurn(rootPath: string, opts: ChurnOptions = {}): Map<string, number> {
  console.error(`[churn] computing churn for ${rootPath}`)
  const counts = new Map<string, number>()
  if (git(rootPath, ['rev-parse', '--is-inside-work-tree']) == null) {
    console.error(`[churn] not a git checkout, returning empty`)
    return counts
  }
  // Prefix of rootPath within the git repo (e.g. "frontend/"), to strip later.
  const prefix = (git(rootPath, ['rev-parse', '--show-prefix']) ?? '').trim()
  const windowDays = opts.windowDays ?? 90
  console.error(`[churn] git log --since=${windowDays} days --name-only (prefix=${prefix || '(root)'})`)
  const out = git(rootPath, [
    'log',
    `--since=${windowDays} days ago`,
    '--name-only',
    '--format=tformat:',
    '--',
    '.',
  ])
  if (out == null) {
    console.error(`[churn] git log failed, returning empty`)
    return counts
  }
  console.error(`[churn] git returned file list`)
  for (const raw of out.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    // git paths are repo-root-relative; strip our subdir prefix to match graph.
    if (prefix && !line.startsWith(prefix)) continue
    const rel = prefix ? line.slice(prefix.length) : line
    counts.set(rel, (counts.get(rel) ?? 0) + 1)
  }
  console.error(`[churn] done: ${counts.size} files with commits`)
  return counts
}

export interface HotspotsOptions {
  /** Token ceiling for the view (default 600). */
  budgetTokens?: number
  /** Precomputed churn (else computed from rootPath). */
  churn?: Map<string, number>
  /** Precomputed centrality. */
  centrality?: Centrality
  /** Cap on listed files (default 20). */
  limit?: number
}

/**
 * Rank files as hotspots. With churn available the score blends normalized
 * centrality and normalized churn (load-bearing AND changing); without it,
 * pure centrality. Token-budgeted, anchored.
 */
export function buildHotspots(graph: CodeGraph, opts: HotspotsOptions = {}): ViewResult {
  const centrality = opts.centrality ?? computeCentrality(graph)
  const churn = opts.churn ?? computeChurn(graph.rootPath)
  const hasChurn = churn.size > 0
  const limit = opts.limit ?? 20
  const budget = new TokenBudget(opts.budgetTokens ?? 600)

  const scored = graph.files.map((f) => {
    const c = centrality.scoreByFile.get(f.id) ?? 0
    const commits = churn.get(f.path) ?? 0
    // Saturating churn score in [0,1): commits/(commits+K). Robust to compressed
    // ranges — in a young repo where the busiest file has 3 commits, max-norm
    // would make any 3-commit file outrank a centrality-0.5 hub. Saturation keeps
    // centrality meaningful and only rewards genuinely heavy churn.
    const churnScore = commits / (commits + CHURN_SATURATION)
    const score = hasChurn ? c + churnScore : c
    return { file: f, c, commits, score }
  })
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.file.path.localeCompare(b.file.path)
  })

  const header = hasChurn
    ? `# hotspots — load-bearing × recently-changed (${churn.size} files touched)\n`
    : '# hotspots — import centrality (no git churn data)\n'
  budget.add(header)
  const lines: string[] = []
  const fileIds: number[] = []
  let shown = 0
  for (const s of scored) {
    if (shown >= limit) break
    if (s.c === 0 && s.commits === 0) break // nothing load-bearing or changing left
    const churnPart = hasChurn ? `, ${s.commits} commits` : ''
    const line = `  ${s.file.path}  (centrality ${s.c.toFixed(2)}${churnPart})  @${s.file.path}:1`
    if (!budget.tryAdd('\n' + line)) break
    lines.push(line)
    fileIds.push(s.file.id)
    shown++
  }
  return { text: header + lines.join('\n'), fileIds }
}
