// resolve_context — the reactive one-shot interceptor. Turns a task description
// into a tight, ready-to-work context in a single call, so the agent doesn't
// spend its first N turns exploring. It personalizes the ranking toward the task
// (rankForTask), leads with a compact personalized skeleton, then appends the
// import neighborhoods of the most relevant files — all under one token budget.

import { estimateTokens } from './budget.js'
import { buildNeighborhood } from './neighborhood.js'
import { computeCentrality } from './rank.js'
import { rankForTask } from './rank.js'
import { buildSkeleton, type ViewResult } from './skeleton.js'
import type { CodeGraph } from './types.js'

export interface ResolveContextOptions {
  /** Free-text task description; drives the personalized ranking. */
  taskText: string
  /** Total token ceiling for the whole context (default 2500). */
  budgetTokens?: number
  /** How many top-ranked files to expand into neighborhoods (default 2). */
  focusFiles?: number
  /** Neighborhood depth for the focus files (default 1). */
  neighborhoodDepth?: number
}

/**
 * Build a task-personalized working context. Returns the rendered text plus the
 * union of file ids it referenced (for the savings receipt). Always well-defined:
 * falls back to plain centrality when the task matches nothing.
 */
export function resolveContext(graph: CodeGraph, opts: ResolveContextOptions): ViewResult {
  const budget = opts.budgetTokens ?? 2500
  const focusN = Math.max(1, opts.focusFiles ?? 2)
  const depth = opts.neighborhoodDepth ?? 1
  const centrality = computeCentrality(graph)
  const ranking = rankForTask(graph, { taskText: opts.taskText, centrality })

  const fileIds = new Set<number>()
  const parts: string[] = [`# context for: ${opts.taskText.trim()}\n`]

  // Lead with a personalized skeleton using ~45% of the budget.
  const skel = buildSkeleton(graph, {
    budgetTokens: Math.max(400, Math.round(budget * 0.45)),
    ranking,
  })
  parts.push('## Most relevant files (task-ranked)\n' + skel.text)
  skel.fileIds.forEach((id) => fileIds.add(id))

  // Spend the remainder on the neighborhoods of the top focus files that have a
  // public surface (skip pure re-export / no-symbol files — low signal here).
  let spent = estimateTokens(parts.join('\n'))
  const remaining = Math.max(0, budget - spent)
  const focusCandidates = ranking
    .filter((r) => (graph.symbolsByFile.get(r.fileId)?.length ?? 0) > 0)
    .slice(0, focusN)

  if (remaining > 200 && focusCandidates.length > 0) {
    const per = Math.max(300, Math.floor(remaining / focusCandidates.length))
    const hoods: string[] = []
    for (const r of focusCandidates) {
      const hood = buildNeighborhood(graph, r.fileId, {
        depth,
        budgetTokens: per,
        centrality,
      })
      hoods.push(hood.text)
      hood.fileIds.forEach((id) => fileIds.add(id))
    }
    parts.push('## Key neighborhoods (import structure)\n' + hoods.join('\n\n'))
  }

  parts.push(
    '\n— Every line carries a path:line anchor. Read source only where a slice is insufficient.',
  )
  return { text: parts.join('\n\n'), fileIds: [...fileIds] }
}
