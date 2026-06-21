// The agent-facing tool surface. Each tool has a one-line description
// (descriptions load into the agent's context every turn — a fat surface
// re-creates the bloat we're eliminating). Every tool is token-budgeted and
// returns ranked, elided output with exact `path:line` anchors so the agent can
// fall back to a real file read when a slice is insufficient. Read-only: no
// edits, no scans, no network.
//
// Handlers read the live graph through `getState()` rather than closing over a
// graph snapshot, so `--watch` re-indexing is reflected immediately without
// re-registering tools.

import { z } from 'zod'
import {
  buildHotspots,
  buildNeighborhood,
  buildSkeleton,
  dependenciesOf,
  dependentsOf,
  findSymbols,
  resolveContext,
  resolveFileTarget,
  sliceSymbolSource,
  TokenBudget,
  type Centrality,
  type CodeGraph,
} from '@openvisio/core'
import type { UserRequest } from './spotlight.js'

/**
 * Optional capabilities wired in only when the server runs with `--spotlight`.
 * `takeRequest` drains the next viewer-composed instruction from the request
 * queue (see spotlight.ts), powering the get_user_request tool. Kept optional so
 * a plain `openvisio mcp` keeps the lean read-only tool surface.
 */
export interface ToolDeps {
  takeRequest?: () => UserRequest | null
  /** Push a reply to a viewer question back to the open viewer (answer SSE). */
  postAnswer?: (requestId: string, answer: string) => void
}

/** The live, swappable index state the tools read on every call. */
export interface GraphState {
  graph: CodeGraph
  centrality: Centrality
  /** Repo-relative path → recent commit count (empty when not a git repo). */
  churn: Map<string, number>
}

/** What a tool returns: the text shown to the agent + the file ids it referenced. */
export interface ToolResult {
  text: string
  /** Files the agent would otherwise have read — the savings-receipt baseline. */
  touchedFiles: number[]
}

/** A ready-to-register tool: name, one-line description, Zod input shape, handler. */
export interface ToolDef {
  name: string
  description: string
  inputShape: z.ZodRawShape
  handler: (args: Record<string, unknown>) => ToolResult
}

type GetState = () => GraphState

const budgetArg = (def: number) =>
  z.number().int().positive().max(20000).optional().describe(`Token budget (default ${def}).`)

// ---------------------------------------------------------------------------
// resolve_context — the one-shot interceptor. Call FIRST on a fresh task.
// ---------------------------------------------------------------------------
function resolveContextTool(getState: GetState): ToolDef {
  return {
    name: 'resolve_context',
    description:
      'Turn a task description into ready-to-work context in ONE call: a task-ranked skeleton + the neighborhoods of the most relevant files. Call this FIRST on any task.',
    inputShape: {
      task_description: z.string().describe('What you are about to work on.'),
      budget_tokens: budgetArg(2500),
    },
    handler: (args) => {
      const { graph } = getState()
      const r = resolveContext(graph, {
        taskText: args.task_description as string,
        budgetTokens: (args.budget_tokens as number | undefined) ?? 2500,
      })
      return { text: r.text, touchedFiles: r.fileIds }
    },
  }
}

// ---------------------------------------------------------------------------
// get_repo_skeleton — the one-shot priming layer.
// ---------------------------------------------------------------------------
function skeletonTool(getState: GetState): ToolDef {
  return {
    name: 'get_repo_skeleton',
    description:
      'Complete map of the repo: the most import-central files with their public symbols + signatures (budgeted), then a full inventory of EVERY other file path — nothing hidden. Call this FIRST instead of crawling files.',
    inputShape: { budget_tokens: budgetArg(2500) },
    handler: (args) => {
      const { graph } = getState()
      const budgetTokens = (args.budget_tokens as number | undefined) ?? 2500
      // fullInventory: list every file (like the atlas), so the agent sees the
      // whole repo, not just the budgeted top slice.
      const r = buildSkeleton(graph, { budgetTokens, fullInventory: true })
      return { text: r.text, touchedFiles: r.fileIds }
    },
  }
}

// ---------------------------------------------------------------------------
// find_symbol — locate a definition without reading whole files.
// ---------------------------------------------------------------------------
function findSymbolTool(getState: GetState): ToolDef {
  return {
    name: 'find_symbol',
    description:
      'Locate a function/class/type by name or pattern: returns signature, exact path:line anchor, and the (elided) definition body — no whole-file reads.',
    inputShape: {
      name: z.string().optional().describe('Exact symbol name.'),
      pattern: z.string().optional().describe('Case-insensitive regex over symbol names.'),
      budget_tokens: budgetArg(800),
    },
    handler: (args) => {
      const { graph, centrality } = getState()
      const name = args.name as string | undefined
      const pattern = args.pattern as string | undefined
      if (!name && !pattern) return { text: 'Provide `name` or `pattern`.', touchedFiles: [] }
      const budget = new TokenBudget((args.budget_tokens as number | undefined) ?? 800)
      const hits = findSymbols(graph, { name, pattern, centrality })
      if (hits.length === 0) return { text: `No symbols match ${name ?? pattern}.`, touchedFiles: [] }

      const blocks: string[] = []
      const touched = new Set<number>()
      let shown = 0
      for (const hit of hits) {
        const slice = sliceSymbolSource(graph, hit.symbol, { budgetTokens: 300 })
        const anchor = slice?.anchor ?? `${hit.file.path}:${hit.symbol.startLine}-${hit.symbol.endLine}`
        const header = `${hit.symbol.signature}  @${anchor}`
        const source = slice ? slice.source : '(source unavailable — read the anchor)'
        const block = `${header}\n${source}`
        if (!budget.tryAdd('\n\n' + block)) break
        blocks.push(block)
        touched.add(hit.file.id)
        shown++
      }
      const omitted = hits.length - shown
      const footer = omitted > 0 ? `\n\n… ${omitted} more match(es) omitted (narrow the query).` : ''
      return { text: blocks.join('\n\n') + footer, touchedFiles: [...touched] }
    },
  }
}

// ---------------------------------------------------------------------------
// get_neighborhood — the local subgraph a senior engineer would point at.
// ---------------------------------------------------------------------------
function neighborhoodTool(getState: GetState): ToolDef {
  return {
    name: 'get_neighborhood',
    description:
      'Local import subgraph around a file/symbol (its dependents + dependencies to a depth), each with signatures + anchors. Token-budgeted.',
    inputShape: {
      target: z.string().describe('A file path, path suffix, or symbol name.'),
      depth: z.number().int().min(1).max(3).optional().describe('Import hops out (default 1).'),
      budget_tokens: budgetArg(1200),
    },
    handler: (args) => {
      const { graph, centrality } = getState()
      const target = args.target as string
      const fileId = resolveFileTarget(graph, target)
      if (fileId == null) {
        return {
          text: `Could not resolve "${target}" to a single file (unknown or ambiguous). Try a fuller path.`,
          touchedFiles: [],
        }
      }
      const r = buildNeighborhood(graph, fileId, {
        depth: (args.depth as number | undefined) ?? 1,
        budgetTokens: (args.budget_tokens as number | undefined) ?? 1200,
        centrality,
      })
      return { text: r.text, touchedFiles: r.fileIds }
    },
  }
}

// ---------------------------------------------------------------------------
// get_dependents — directed impact analysis ("if I change X, what breaks").
// direction=dependencies flips it to "what X needs".
// ---------------------------------------------------------------------------
function dependentsTool(getState: GetState): ToolDef {
  return {
    name: 'get_dependents',
    description:
      'Directed impact analysis over import edges: files that depend on a target file/symbol (direction=dependencies → files it depends on). Each ranked, anchored.',
    inputShape: {
      target: z.string().describe('A file path, path suffix, or symbol name.'),
      direction: z
        .enum(['dependents', 'dependencies'])
        .optional()
        .describe('"dependents" (who imports target, default) or "dependencies" (what target imports).'),
      budget_tokens: budgetArg(800),
    },
    handler: (args) => {
      const { graph, centrality } = getState()
      const target = args.target as string
      const direction = (args.direction as string | undefined) ?? 'dependents'
      const fileId = resolveFileTarget(graph, target)
      if (fileId == null) {
        return {
          text: `Could not resolve "${target}" to a single file (unknown or ambiguous). Try a fuller path.`,
          touchedFiles: [],
        }
      }
      const self = graph.filesById.get(fileId)!
      const hits =
        direction === 'dependencies'
          ? dependenciesOf(graph, fileId, centrality)
          : dependentsOf(graph, fileId, centrality)
      const verb = direction === 'dependencies' ? 'imports' : 'is imported by'
      if (hits.length === 0) return { text: `${self.path} ${verb} nothing (in-graph).`, touchedFiles: [fileId] }

      const budget = new TokenBudget((args.budget_tokens as number | undefined) ?? 800)
      const head = `${self.path} ${verb} ${hits.length} file(s):`
      budget.add(head)
      const lines: string[] = []
      const touched = new Set<number>([fileId])
      let shown = 0
      for (const hit of hits) {
        const line = `  ${hit.file.path}  (×${hit.weight}, centrality ${hit.score.toFixed(2)})  @${hit.file.path}:1`
        if (!budget.tryAdd('\n' + line)) break
        lines.push(line)
        touched.add(hit.file.id)
        shown++
      }
      const omitted = hits.length - shown
      const footer = omitted > 0 ? `\n  … ${omitted} more omitted.` : ''
      return { text: head + '\n' + lines.join('\n') + footer, touchedFiles: [...touched] }
    },
  }
}

// ---------------------------------------------------------------------------
// get_hotspots — where's the load-bearing / risky code (centrality × churn).
// ---------------------------------------------------------------------------
function hotspotsTool(getState: GetState): ToolDef {
  return {
    name: 'get_hotspots',
    description:
      'Ranked load-bearing / risky files: high import centrality (and high git churn when available). Cheap "where to look first".',
    inputShape: { budget_tokens: budgetArg(600) },
    handler: (args) => {
      const { graph, centrality, churn } = getState()
      const r = buildHotspots(graph, {
        budgetTokens: (args.budget_tokens as number | undefined) ?? 600,
        centrality,
        churn,
      })
      return { text: r.text, touchedFiles: r.fileIds }
    },
  }
}

// ---------------------------------------------------------------------------
// get_languages — language inventory: per-language file count + total loc,
// ranked by lines descending. The "what is this repo written in" one-liner.
// ---------------------------------------------------------------------------
function languagesTool(getState: GetState): ToolDef {
  return {
    name: 'get_languages',
    description:
      'Language inventory of the indexed repo: every language with its file count and total lines of code, ranked by lines descending. The "what is this written in" one-shot.',
    inputShape: { budget_tokens: budgetArg(500) },
    handler: (args) => {
      const { graph } = getState()
      // Aggregate files by language: count + summed loc.
      const stats = new Map<string, { files: number; loc: number }>()
      let totalLoc = 0
      for (const f of graph.files) {
        const s = stats.get(f.language) ?? { files: 0, loc: 0 }
        s.files += 1
        s.loc += f.loc
        stats.set(f.language, s)
        totalLoc += f.loc
      }
      const ranked = [...stats.entries()].sort(
        // Lines descending; break ties by file count, then name for determinism.
        (a, b) => b[1].loc - a[1].loc || b[1].files - a[1].files || a[0].localeCompare(b[0]),
      )
      if (ranked.length === 0) return { text: 'No files indexed.', touchedFiles: [] }

      const budget = new TokenBudget((args.budget_tokens as number | undefined) ?? 500)
      const head = `${ranked.length} language(s) across ${graph.files.length} files, ${totalLoc} loc:`
      budget.add(head)
      const langW = Math.min(20, Math.max(...ranked.map(([lang]) => lang.length)))
      const lines: string[] = []
      let shown = 0
      for (const [lang, s] of ranked) {
        const line = `  ${lang.padEnd(langW)}  ${String(s.files).padStart(5)} file(s)  ${String(s.loc).padStart(8)} loc`
        if (!budget.tryAdd('\n' + line)) break
        lines.push(line)
        shown++
      }
      const omitted = ranked.length - shown
      const footer = omitted > 0 ? `\n  … ${omitted} more language(s) omitted (raise budget_tokens).` : ''
      return { text: head + '\n' + lines.join('\n') + footer, touchedFiles: [] }
    },
  }
}

// ---------------------------------------------------------------------------
// get_user_request — the reverse channel. Pull an instruction the developer
// composed in the open OpenVisio viewer, with its selection staged as context.
// Only registered under --spotlight (its queue lives on the spotlight server).
// ---------------------------------------------------------------------------
function getUserRequestTool(getState: GetState, takeRequest: () => UserRequest | null): ToolDef {
  return {
    name: 'get_user_request',
    description:
      "Pull the developer's pending instruction from the open OpenVisio viewer (their selected files + a ranked, staged context). Call when they say to do what they selected/highlighted in the viewer.",
    inputShape: { budget_tokens: budgetArg(2500) },
    handler: (args) => {
      const req = takeRequest()
      if (!req) return { text: 'No pending viewer request.', touchedFiles: [] }
      const { graph } = getState()

      // Resolve the selected paths to file ids so the spotlight round-trips back
      // to exactly the files the developer picked (dropped if unresolvable).
      const selected = new Set<number>()
      for (const p of req.paths) {
        const id = resolveFileTarget(graph, p)
        if (id != null) selected.add(id)
      }

      // Stage context: run the same resolver the agent would call first, biased
      // toward the selection by folding the picked paths into the task text.
      const focusList = req.paths.length ? `\n\nFocus files:\n${req.paths.join('\n')}` : ''
      const r = resolveContext(graph, {
        taskText: `${req.instruction}${focusList}`,
        budgetTokens: req.budgetTokens ?? (args.budget_tokens as number | undefined) ?? 2500,
      })

      const refs = req.paths.length ? req.paths.map((p) => `@${p}`).join(' ') : '(none)'
      const isQuestion = req.kind === 'question'
      // A question expects a reply routed back to the viewer; an instruction is
      // fire-and-forget. Tell the agent exactly how to close the loop.
      const directive = isQuestion
        ? `## This is a QUESTION (request_id: ${req.id})\nAnswer it using the staged context, then call \`submit_answer\` with request_id="${req.id}" and your answer so it shows in the viewer.`
        : `## This is an INSTRUCTION (request_id: ${req.id})\nCarry it out using the staged context.`
      const text = [
        `# ${isQuestion ? 'Question' : 'Instruction'} from the OpenVisio viewer`,
        req.instruction,
        '',
        `## Selected files\n${refs}`,
        '',
        directive,
        '',
        `## Staged context\n${r.text}`,
      ].join('\n')

      const touched = new Set<number>([...selected, ...r.fileIds])
      return { text, touchedFiles: [...touched] }
    },
  }
}

// ---------------------------------------------------------------------------
// submit_answer — the return leg. Push the agent's reply to a viewer QUESTION
// back to the open viewer (delivered as an 'answer' SSE frame). Only registered
// under --spotlight.
// ---------------------------------------------------------------------------
function submitAnswerTool(postAnswer: (requestId: string, answer: string) => void): ToolDef {
  return {
    name: 'submit_answer',
    description:
      "Send your reply to a viewer question (from get_user_request) back to the open OpenVisio viewer. Pass the request_id you were given and your answer text.",
    inputShape: {
      request_id: z.string().describe('The request_id from get_user_request.'),
      answer: z.string().describe('Your answer, shown in the viewer.'),
    },
    handler: (args) => {
      const requestId = args.request_id as string
      const answer = args.answer as string
      if (!requestId || !answer) return { text: 'Provide both request_id and answer.', touchedFiles: [] }
      postAnswer(requestId, answer)
      return { text: `Answer delivered to the viewer (request ${requestId}).`, touchedFiles: [] }
    },
  }
}

/**
 * Build the full tool set bound to a live state accessor. Order reads task-first
 * (resolve_context, skeleton) then drill-down tools. Keep this list tiny — every
 * entry is a per-turn context tax. `deps.takeRequest` (only present under
 * --spotlight) adds the reverse-channel get_user_request tool.
 */
export function buildTools(getState: GetState, deps?: ToolDeps): ToolDef[] {
  const tools = [
    resolveContextTool(getState),
    skeletonTool(getState),
    findSymbolTool(getState),
    neighborhoodTool(getState),
    dependentsTool(getState),
    hotspotsTool(getState),
    languagesTool(getState),
  ]
  if (deps?.takeRequest) tools.push(getUserRequestTool(getState, deps.takeRequest))
  if (deps?.postAnswer) tools.push(submitAnswerTool(deps.postAnswer))
  return tools
}
