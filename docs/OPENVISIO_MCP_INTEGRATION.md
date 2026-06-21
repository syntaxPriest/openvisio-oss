# OPENVISIO_MCP_INTEGRATION.md

> Instructions for Claude Code when adding an **MCP server mode** to the existing OpenVisio repo. Read this fully before writing or editing code. This is **additive** — you are not rewriting the scanner, parser, graph builder, or viewer. You are adding a second consumer of the graph that already exists, plus a thin UI channel so the City/edges views light up while an agent queries.

---

## 0. What you're adding

OpenVisio already scans a repo, builds an in-memory graph (nodes, directed import edges, folder hierarchy, pseudo-LOC, PCA/covariance metrics), serves it at `GET /api/graph`, and renders it in the Three.js viewer (3D **City** view + **edges/import-graph** view).

You are adding:

1. **`openvisio mcp`** — an MCP server that exposes the *same in-memory graph* to Claude Code and Codex as a small set of token-cheap, graph-native tools, so the agent queries structure instead of crawling files.
2. **A live "agent spotlight" channel** — when the agent calls a tool, the corresponding buildings (City view) and edges (graph view) highlight in any open viewer, so the human sees what the agent is looking at.

One graph, two faces: the **viewer is for the human**, the **MCP server is for the agent**. They share the index. Do not build a second graph.

### North star (carried over from the project)

> *"Would a senior engineer onboarding a new hire do this?"*

For the MCP layer this becomes: **point the agent at the 3–7 load-bearing things, don't read the repo aloud.** Every tool returns a ranked, elided, token-budgeted slice — never a raw file dump.

---

## 1. Non-negotiable constraints

Violating any of these defeats the purpose of the feature.

1. **Reuse the existing graph.** The MCP server consumes the same graph object the viewer/`/api/graph` consume. If the graph builder isn't currently exposed as an importable module, refactor it into one — but do not fork or duplicate parsing logic.
2. **Tiny default tool surface.** Target ~5–7 tools, each with a one-line description. Tool definitions load into the agent's context *every turn*; a fat surface re-creates the exact bloat we're eliminating (a single oversized MCP server can cost tens of thousands of tokens per turn before the user types anything).
3. **Every response is token-budgeted.** No tool returns unbounded output. Each takes (or defaults) a `budget_tokens` and truncates by relevance rank to fit it.
4. **Graph-first, not graph-only.** Tools return the minimal relevant slice plus exact file paths + line ranges, so the agent can fall back to a real file read when the slice is insufficient. Never block the agent from reading source — just make it rarely necessary.
5. **Local-first, read-only.** No network calls, no telemetry, no SaaS. The MCP server **does not edit code** and **does not do security scanning** — it supplies *understanding*; the harness (Claude Code/Codex) does the edits.
6. **No new heavy dependencies in the hot path.** Ranking and serialization run on the already-built graph in memory. Adding the MCP SDK is fine; adding a second datastore is not (the existing graph is the source of truth).

---

## 2. Architecture & where it slots

```
                  ┌──────────────────────────────────────────────┐
   repo  ───────► │  OpenVisio core (EXISTING — do not rewrite)   │
                  │   scanner → parser → graphBuilder              │
                  │   → Graph (nodes, importEdges, folderTree,     │
                  │     metrics, pca)   [in memory]                │
                  └───────┬───────────────────┬──────────────────┘
                          │                   │
        GET /api/graph ◄──┘                   ├──► NEW: graph/rank.ts  (PageRank over importEdges)
              │                               │
              ▼                               ├──► NEW: mcp/server.ts  (stdio + optional HTTP)
   Three.js viewer (EXISTING)                 │         small tool surface, token-budgeted
     City view + edges view                   │
              ▲                               └──► NEW: spotlight bus (SSE/WS)
              │                                          tool calls → highlight events
              └───────────── highlight events ◄─────────┘
                                                          ▼
                                          Claude Code / Codex (MCP client)
```

### Monorepo placement

Assume the current workspace monorepo (CLI/server package + viewer package). Add inside the CLI/server package:

```
src/
  graph/
    builder.ts          # EXISTING — ensure it exports the Graph + a getGraph() accessor
    rank.ts             # NEW — PageRank + relevance scoring over importEdges
    skeleton.ts         # NEW — serialize ranked graph → token-budgeted skeleton
    slice.ts            # NEW — neighborhood/symbol slicing + elision helpers
  mcp/
    server.ts           # NEW — MCP server wiring (stdio + optional HTTP transport)
    tools.ts            # NEW — tool definitions + handlers (the 5–7 tools)
    budget.ts           # NEW — token estimation + truncate-by-rank
    spotlight.ts        # NEW — emits highlight events to the viewer bus
  server/
    http.ts             # EXISTING (Bun.serve) — add SSE/WS endpoint for spotlight
  cli.ts                # EXISTING — add the `mcp` subcommand
```

> If the core is in a different language/layout than assumed (e.g. a Python backend rather than Bun/TS), keep the *structure and contracts* below and port them; the design carries over.

---

## 3. The graph contract (internal API the MCP layer consumes)

Pin down (or adapt to) the shape the graph builder already produces. The MCP layer depends only on this contract:

```ts
interface Graph {
  nodes: GraphNode[];
  importEdges: ImportEdge[];        // directed: from imports to
  folderTree: FolderNode;           // hierarchy used by City view
  // metrics already computed for the viewer (LOC proxy, PCA coords, etc.)
}

interface GraphNode {
  id: string;                       // stable id used by the viewer too
  path: string;                     // file path relative to repo root
  kind: 'file' | 'module' | 'symbol';
  symbols?: SymbolDef[];            // public surface if extracted (tree-sitter)
  loc: number;                      // pseudo-LOC (City building height source)
  // any viewer metrics: pca:[x,y,z], churn?, etc.
}

interface SymbolDef {
  name: string;
  signature?: string;               // type/call signature if available
  line: number;
  endLine: number;
  exported: boolean;
}

interface ImportEdge { from: string; to: string; }  // node ids
```

If `symbols` is **not** currently extracted (the viewer may only need file-level nodes + import edges), add a tree-sitter pass that extracts each file's *public surface* (top-level functions, classes, exported types + signatures). This is the same data Aider-style repo maps use and it is what makes symbol-level tools cheap. Cache parse results by file mtime so re-scans are incremental.

---

## 4. Ranking: the skeleton (`graph/rank.ts`)

The skeleton is the core asset. **Rank, don't dump.** A symbol referenced by 20 others is more valuable context than a private helper referenced once.

Implement:

1. **`computeCentrality(graph)`** — personalized PageRank over `importEdges` (files = nodes, import relationships = edges). Deterministic; cache until the graph changes.
2. **`rankForTask(graph, taskText?, focusNodeIds?)`** — relevance score = centrality, optionally re-weighted toward nodes whose path/symbol names match `taskText` tokens or that neighbor `focusNodeIds`. This personalization is what makes `resolve_context` (§6.5) tight.
3. **Stable output** — same inputs → same ranking, so cached agent context doesn't churn.

Reuse centrality for the City/edges UI too if it isn't already driving building prominence — high-centrality buildings can render taller/brighter, which means the human and the agent literally see the same "load-bearing" judgment.

---

## 5. The MCP server (`mcp/server.ts`)

- **SDK:** the official MCP SDK for the core's language (`@modelcontextprotocol/sdk` for TS).
- **Transport:** **stdio by default** (this is how Claude Code and Codex launch and talk to a local server), with an optional `--http` flag reusing the existing `Bun.serve` for HTTP/SSE clients.
- **Lifecycle:** `openvisio mcp [path] [--http] [--watch]` runs the existing scan + graph build, then starts the MCP server instead of opening a browser. With `--watch`, re-index incrementally on file changes (mtime-invalidated parse cache) so the agent's view stays fresh mid-session.
- **Shared graph:** build once, hold in memory, share between MCP handlers and (if `--http`) the `/api/graph` + viewer.

### Client configuration to document in the README

Claude Code:
```bash
claude mcp add openvisio -- openvisio mcp /path/to/repo
```

Codex (`~/.codex/config.toml` or project config):
```toml
[mcp_servers.openvisio]
command = "openvisio"
args = ["mcp", "/path/to/repo"]
```

Both connect over stdio. No API keys, no network.

---

## 6. Tool surface (`mcp/tools.ts`)

Keep descriptions to one line. Every tool accepts `budget_tokens` (sane default) and returns ranked, elided output with exact `path:line-endLine` anchors. Implement these and **no more** for v1:

### 6.1 `get_repo_skeleton`
- **Purpose:** the one-shot priming layer. The agent's *first* move on any task.
- **Input:** `{ budget_tokens=1500 }`
- **Output:** top-ranked files/modules by centrality, each with its public surface (names + signatures), elided to budget. A coherent skeleton of the whole repo for ~1–2K tokens.
- **Backed by:** `rank.computeCentrality` + `skeleton.ts`.

### 6.2 `find_symbol`
- **Purpose:** locate a definition without reading whole files.
- **Input:** `{ name | pattern, budget_tokens=800 }`
- **Output:** matching symbols with `path:line`, signature, and the minimal source slice (the definition body, elided if huge).
- **Backed by:** node `symbols` index.

### 6.3 `get_dependents` / `get_dependencies`
- **Purpose:** directed impact analysis — who calls this / what this needs.
- **Input:** `{ target (symbol|file), budget_tokens=800 }`
- **Output:** ranked incoming/outgoing edges with anchors. This is OpenVisio's existing import-edge data served as "if I change X, what breaks."
- **Backed by:** `importEdges`.

### 6.4 `get_neighborhood`
- **Purpose:** the slice a senior engineer would point at.
- **Input:** `{ node, depth=1, budget_tokens=1200 }`
- **Output:** the local subgraph (node + its dependents/dependencies to `depth`), with signatures, token-budgeted.
- **Backed by:** `slice.ts` over `importEdges`.

### 6.5 `resolve_context`  *(the "one-shot prompt interception")*
- **Purpose:** turn a task description into a tight, ready-to-work context in **one call**, so the agent doesn't spend its first N turns exploring.
- **Input:** `{ task_description, budget_tokens=2500 }`
- **Output:** task-personalized ranked skeleton + the neighborhoods of the most relevant nodes + their key signatures/anchors.
- **Backed by:** `rank.rankForTask` + `slice.ts`. This is the highest-value tool — prompt agents (via the tool description and README) to call it first.

### 6.6 `get_hotspots`
- **Purpose:** "where's the load-bearing / risky code."
- **Input:** `{ budget_tokens=600 }`
- **Output:** high-centrality (+ high-churn if git data available) nodes, ranked.
- **Backed by:** centrality (+ optional `git log` churn).

**Out of scope for v1 tools:** any file write/edit, any whole-file dump tool, security scanning, semantic/embedding search (can come later as a separate ranked source; don't add a vector store in v1).

---

## 7. UI integration: City + edges as the agent's live spotlight

This is the differentiator: the human watches, in the existing 3D City and edges views, what the agent is querying.

### 7.1 Shared-graph principle (already true — make it explicit)
The MCP tools and the viewer read the **same node ids**. A node the agent resolves is the *same building* the human sees. Don't introduce a separate id space.

### 7.2 Spotlight channel (`mcp/spotlight.ts` + `server/http.ts`)
- Add an SSE (or WS) endpoint to the existing server, e.g. `GET /api/spotlight` (event stream).
- Each tool handler, after computing its result, emits a highlight event:
  ```ts
  emitSpotlight({
    tool: 'resolve_context',
    focus: rankedNodeIds.slice(0, K),   // primary buildings to highlight
    edges: relevantEdgeIds,             // import edges to emphasize
    dim: true                           // optionally dim the rest
  });
  ```
- Viewer subscribes and, on event:
  - **City view:** pulse/raise/recolor the `focus` buildings; dim others.
  - **Edges view:** emphasize `edges`, fade unrelated edges.
  - Show a small toast: `agent · resolve_context · 7 nodes`.
- The viewer works fine with the stream absent (e.g. when run headless for an agent only). Spotlight is purely additive.

### 7.3 Why this matters
It makes the abstract ("the agent is exploring") concrete and reviewable, and it reinforces the product story: *you bought OpenVisio to see your codebase — now your coding agent sees it the same way, and you watch it work.*

---

## 8. Token-budgeting & elision rules (`mcp/budget.ts`)

1. **Estimate tokens** with a cheap heuristic (~4 chars/token; sample long bodies). Exactness isn't needed — staying under budget is.
2. **Fill by rank.** Add highest-ranked items until the next item would exceed budget; then stop. Never partially emit a body that misleads.
3. **Elide bodies.** For symbols, prefer signature + a few key lines + `… (N more lines at path:line)` over full bodies. Always include the anchor so the agent can read the full thing if needed.
4. **Always include anchors.** Every emitted item carries `path` and `line-endLine`. This is what makes graph-first safe.
5. **Summarize, don't truncate, large neighborhoods.** If a neighborhood blows the budget, return the ranked node list with one-line-each instead of cutting mid-list.

---

## 9. Measurement: prove the savings

Bake the receipt in — value must be visible, and you can't claim a win without a baseline.

1. **Baseline first.** Before wiring anything, run a representative task in Claude Code on a target repo *without* OpenVisio and record `/context` token counts and tool-call count. Do the same for Codex via `/status`.
2. **Per-session receipt.** Track tokens returned by OpenVisio tools vs an estimated file-exploration baseline (estimated tokens had the agent read the files it would otherwise have read). On server shutdown, print a one-line receipt: `openvisio: 6 tool calls · ~38K est. tokens saved · 2.3× fewer reads`.
3. **Report deltas in the README** from your own runs; don't quote external numbers as if they're OpenVisio's. The realistic target on large repos is order-of-magnitude fewer tokens on *exploration* with a few points of answer-quality tradeoff vs exhaustive reading — that's the honest claim.

---

## 10. Build order

Ship in phases; each phase is independently testable. Do not start a phase before the prior phase's acceptance criteria (§12) pass.

**Phase 0 — Skeleton, no MCP.** Add `rank.ts` + `skeleton.ts`. Add `openvisio skeleton [path] --budget=1500` that prints the ranked skeleton to stdout. Paste it into Claude Code manually; confirm `/context` shows it's compact and that the agent stops crawling. *This validates the asset before any protocol work.*

**Phase 1 — Minimal MCP.** Add `mcp/server.ts` + `tools.ts` with three tools: `get_repo_skeleton`, `find_symbol`, `get_dependents`. stdio transport. Document Claude Code + Codex config. Re-run the §9 baseline task through the server; record the delta.

**Phase 2 — Interception + neighborhoods.** Add `resolve_context`, `get_neighborhood`, `get_hotspots`. Make the README/tool descriptions steer the agent to call `resolve_context` first. Add the per-session savings receipt.

**Phase 3 — Spotlight UI.** Add the SSE/WS endpoint + viewer highlight handling for City and edges views. Verify a tool call lights up the right buildings/edges live.

**Phase 4 — Incremental `--watch`.** mtime-invalidated parse cache; re-index changed files only so the graph stays fresh during a session without a full rebuild.

---

## 11. Conventions for Claude Code

- **Don't recreate bloat.** Resist adding tools "for completeness." Each new tool's schema is a per-turn tax on every user of the server. If a capability isn't worth a permanent context cost, it doesn't ship.
- **Reuse, don't fork.** Any parsing/graph logic you need already exists in the builder — import it. If it's not importable, refactor it to be, in a separate commit, without changing behavior.
- **Keep the viewer working headless and connected.** Nothing in the MCP path may break `openvisio` (the normal viewer run). Spotlight degrades gracefully when no viewer is attached.
- **Deterministic ranking.** No randomness in PageRank/relevance; agents cache context and churn is expensive.
- **Anchors everywhere.** If a tool returns code without a `path:line` anchor, that's a bug.
- **No edits, no scans, no network.** If a task seems to want those, stop — it's out of scope for this server.

---

## 12. Acceptance criteria (definition of done per phase)

- **P0:** `openvisio skeleton` on a large repo emits a coherent whole-repo skeleton under the token budget, with the most-referenced symbols present and trivial helpers absent. Deterministic across runs.
- **P1:** Claude Code and Codex both connect over stdio and successfully call all three tools. On the baseline task, measured `/context` (or `/status`) tokens are materially lower and tool-call count is lower than the no-OpenVisio baseline.
- **P2:** A cold-start task answered via a single `resolve_context` call returns enough to begin editing without further exploration in the common case; receipt prints on shutdown.
- **P3:** Calling any tool visibly highlights the correct buildings (City) and edges (graph) in an open viewer within ~250ms; viewer with no stream attached is unaffected.
- **P4:** Editing one file triggers re-index of only the affected nodes/edges; subsequent tool calls reflect the change without a full rescan.

---

## 13. Out of scope (say no to these)

- File editing / code generation (the harness does that).
- Security scanning, license scanning, code review.
- A second datastore (vector DB, SQLite) in v1 — the in-memory graph is the source of truth.
- Hosted/SaaS mode, accounts, telemetry.
- Greenfield-codebase optimizations — this feature targets large, existing, structured repos; that's where the wins are real.
