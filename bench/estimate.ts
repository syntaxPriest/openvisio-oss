// OpenVisio token-savings ESTIMATOR.
//
// Produces a deterministic, defensible PROJECTION of the exploration tokens
// OpenVisio saves a coding agent — computed from REAL repo bytes, not invented
// numbers. For each task it models what a no-graph agent does (keyword-grep the
// repo, open the matching files, follow their imports one hop) and counts the
// tokens in exactly those files, then compares that to what OpenVisio's
// `resolve_context` actually returns for the same task.
//
// This is an ESTIMATE and labeled as such. The honest, headline numbers for the
// README must come from real Claude Code / Codex runs — see bench/PROTOCOL.md.
//
// Usage:  npx tsx bench/estimate.ts <repo-path> [--tasks=bench/tasks.frontend.json]
//         (default repo: ./frontend, default tasks: that file)

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  buildGraph,
  buildSkeleton,
  estimateTokens,
  resolveContext,
  scanRepo,
  type CodeGraph,
  type ScannedFile,
} from '@openvisio/core'

// An agent reading grep hits doesn't open hundreds of files — it reads the most
// relevant handful, then follows their imports. These caps keep the baseline
// CONSERVATIVE (fewer files read → smaller savings claimed), so the estimate
// never flatters OpenVisio.
const MAX_GREP_FILES = 20
const STOPWORDS = new Set([
  'the', 'and', 'for', 'add', 'with', 'this', 'that', 'from', 'into', 'your',
  'make', 'when', 'where', 'what', 'how', 'why', 'view', 'page', 'code', 'file',
  'files', 'should', 'support', 'using', 'use', 'new', 'get', 'set', 'show',
])

interface Task {
  id: string
  description: string
}

function keywords(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    if (m[0].length >= 4 && !STOPWORDS.has(m[0])) out.add(m[0])
  }
  return [...out]
}

/** Files an agent would open: keyword-grep hits (ranked) + one import hop out. */
function exploredFiles(
  graph: CodeGraph,
  contentByPath: Map<string, string>,
  task: Task,
): { greppedIds: number[]; expandedIds: Set<number> } {
  const kws = keywords(task.description)
  // Require a file to match at least TWO distinct task keywords before counting
  // it as a hit (falls back to 1 for very short tasks). This keeps the baseline
  // honest: a file that merely mentions a single common word like "graph"
  // wouldn't actually be opened by a focused agent.
  const minHits = Math.min(2, kws.length)
  const scored: { id: number; hits: number }[] = []
  for (const f of graph.files) {
    const content = contentByPath.get(f.path)
    if (content === undefined) continue
    const hay = (f.path + '\n' + content).toLowerCase()
    let hits = 0
    for (const kw of kws) if (hay.includes(kw)) hits++
    if (hits >= minHits) scored.push({ id: f.id, hits })
  }
  scored.sort((a, b) => b.hits - a.hits || a.id - b.id)
  const greppedIds = scored.slice(0, MAX_GREP_FILES).map((s) => s.id)

  // Expand one import hop along DEPENDENCIES only: an agent reads a matched file
  // and opens what it imports (types, helpers) to understand it. It does not
  // read every file that imports the match — so we don't count those.
  const expanded = new Set<number>(greppedIds)
  const grepSet = new Set(greppedIds)
  for (const e of graph.edges) {
    if (grepSet.has(e.sourceId)) expanded.add(e.targetId)
  }
  return { greppedIds, expandedIds: expanded }
}

function tokensOfFiles(ids: Iterable<number>, graph: CodeGraph, contentByPath: Map<string, string>): number {
  let total = 0
  for (const id of ids) {
    const f = graph.filesById.get(id)
    if (!f) continue
    const content = contentByPath.get(f.path)
    if (content !== undefined) total += estimateTokens(content)
  }
  return total
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const positional = argv.filter((a) => !a.startsWith('--'))
  const flags = new Map(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const eq = a.indexOf('=')
      return eq === -1 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)]
    }),
  )
  const repoPath = positional[0] ?? 'frontend'
  const tasksFile = flags.get('tasks') ?? 'bench/tasks.frontend.json'

  const tasks: Task[] = JSON.parse(fs.readFileSync(tasksFile, 'utf8'))
  const absRepo = path.resolve(repoPath)

  // Build the graph (the agent's OpenVisio view) and grab real file contents for
  // the baseline. Filter scanned content to the graph's file universe so both
  // sides honor the same excludes (tsconfig/​.gitignore).
  const graph = await buildGraph(repoPath)
  const scanned: ScannedFile[] = scanRepo(repoPath)
  const contentByPath = new Map<string, string>()
  for (const sf of scanned) {
    if (graph.fileIdByPath.has(sf.relPath)) contentByPath.set(sf.relPath, sf.content)
  }

  // Whole-repo "understand this codebase" priming comparison.
  const repoTokens = tokensOfFiles(graph.files.map((f) => f.id), graph, contentByPath)
  const skeleton = buildSkeleton(graph, { budgetTokens: 1500 })
  const skeletonTokens = estimateTokens(skeleton.text)

  const rows: string[] = []
  let sumOv = 0
  let sumBase = 0
  for (const task of tasks) {
    const ctx = resolveContext(graph, { taskText: task.description, budgetTokens: 2500 })
    const ovTokens = estimateTokens(ctx.text)
    const { greppedIds, expandedIds } = exploredFiles(graph, contentByPath, task)
    const baseTokens = tokensOfFiles(expandedIds, graph, contentByPath)
    const ratio = ovTokens > 0 ? baseTokens / ovTokens : 0
    sumOv += ovTokens
    sumBase += baseTokens
    rows.push(
      `| ${task.id} | ${fmt(ovTokens)} | ${fmt(baseTokens)} | ${ratio.toFixed(1)}× | ` +
        `${ctx.fileIds.length} → ${greppedIds.length} grep + ${expandedIds.size - greppedIds.length} imports |`,
    )
  }
  const totalRatio = sumOv > 0 ? sumBase / sumOv : 0

  const report = [
    `# OpenVisio token-savings estimate — ${graph.name}`,
    '',
    `> **Projection, not a measured agent run.** Computed from real repo bytes:`,
    `> the baseline is the token count of the files a keyword-grep agent would`,
    `> open for each task (files matching ≥2 task keywords, capped at ${MAX_GREP_FILES}, plus`,
    `> the files they import), read whole.`,
    `> The headline numbers in the README must come from real Claude Code / Codex`,
    `> runs — see [PROTOCOL.md](./PROTOCOL.md).`,
    '',
    `Repo: \`${absRepo}\` · ${graph.files.length} files · ${graph.symbols.length} symbols · ${graph.edges.length} import edges`,
    '',
    '## Priming (build a whole-repo mental model)',
    '',
    '| | tokens |',
    '|---|---|',
    `| Read the whole repo | ${fmt(repoTokens)} |`,
    `| OpenVisio \`get_repo_skeleton\` | ${fmt(skeletonTokens)} |`,
    `| **Leaner by** | **${(repoTokens / Math.max(1, skeletonTokens)).toFixed(0)}×** |`,
    '',
    '## Per-task (exploration to start working)',
    '',
    '| task | OpenVisio (`resolve_context`) | grep-agent baseline | leaner | files (OV → explored) |',
    '|---|---|---|---|---|',
    ...rows,
    `| **TOTAL** | **${fmt(sumOv)}** | **${fmt(sumBase)}** | **${totalRatio.toFixed(1)}×** | |`,
    '',
    '## Method & honesty notes',
    '',
    `- Baseline = Σ tokens of files a no-graph agent opens: keyword-grep hits`,
    `  (files matching ≥2 distinct task keywords, ranked by breadth, capped at`,
    `  ${MAX_GREP_FILES}) plus the files those import, each read whole. ~4 chars/token.`,
    `- This is **conservative**: real agents often grep more, re-read on misses, and`,
    `  re-process context every agent-loop turn (Codex ~3–5×), none of which is`,
    `  counted here. It also ignores the per-turn tool-definition tax.`,
    `- OpenVisio cost = exact size of \`resolve_context\` output (one call).`,
    `- It does **not** model answer quality. Graph-first trades a few quality points`,
    `  for the token saving (see the research doc); the agent can always fall back`,
    `  to a real file read via the anchors OpenVisio returns.`,
    `- **Repo size matters.** This is a ${graph.files.length}-file repo: it is small and densely`,
    `  connected, so a task's explored set approaches the whole repo and the per-task`,
    `  ratio nears the whole-repo priming ratio. OpenVisio's wins are *concentrated in`,
    `  large, structured repos* (per the research doc) — treat this as a lower bound on`,
    `  the relative shape, not a transferable absolute. Validate on your real repo via`,
    `  [PROTOCOL.md](./PROTOCOL.md).`,
    '',
  ].join('\n')

  const outPath = path.join('bench', `REPORT.${graph.name}.md`)
  fs.writeFileSync(outPath, report)

  // Console summary.
  process.stdout.write(report + `\n\nWrote ${outPath}\n`)
}

main().catch((err) => {
  process.stderr.write(`bench: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exitCode = 1
})
