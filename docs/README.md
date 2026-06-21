# OpenVisio — Documentation

> One graph, two faces: a 3D viewer for the human, an MCP server for the agent.
> They share the same deterministic index.

OpenVisio turns any local repository into a **deterministic code graph** — files,
symbols, resolved import edges, and PageRank centrality — and then exposes that
graph two ways:

- **The Graph** (`core/` + `mcp/`) — an open-source, local-first, read-only CLI
  and MCP server that hands coding agents (Claude Code, Codex, Cursor) a
  **token-cheap, ranked, anchored** view of the codebase, so they query
  *structure* instead of crawling files. No LLM, no network.
- **The Narrator** (`frontend/`) — an interactive Next.js viewer that renders the
  same graph as a navigable map (architecture tree, 3D city, galaxy atlas) with a
  grounded AI narrator that answers questions through your own Claude Code
  session.

This folder is the documentation hub. Start here, then dive into the two
component READMEs.

| Doc | What it covers |
|---|---|
| **[GRAPH.md](./GRAPH.md)** | The OpenVisio graph engine + MCP server/CLI — install, commands, tools, agent wiring |
| **[NARRATOR.md](./NARRATOR.md)** | The viewer + AI narrator — install, run, views, the hands-free agent, VS Code bridge |
| [OPENVISIO_MCP_INTEGRATION.md](./OPENVISIO_MCP_INTEGRATION.md) | Deep dive on the viewer ↔ MCP integration |
| [TESTING.md](./TESTING.md) | Test/smoke notes |
| [openvisio-token-economics-research-and-plan.md](./openvisio-token-economics-research-and-plan.md) | Token-savings research |
| [../bench/PROTOCOL.md](../bench/PROTOCOL.md) | A/B benchmark protocol for measuring token savings |

---

## Repository layout

```
OpenVisio/
├── core/        @openvisio/core — deterministic graph engine (tree-sitter, PageRank). Library only.
├── mcp/         openvisio — the CLI + MCP server (bin: `openvisio`). Depends on core.
├── frontend/    The Next.js viewer + AI narrator (independent install).
├── bench/       Token-savings estimator + A/B protocol.
├── docs/        You are here.
└── backend/     Legacy Mastra agent backend (optional — not required by the current narrator).
```

`core` and `mcp` are npm **workspaces** (one install, one build from the root).
The `frontend` keeps its own independent install.

---

## Prerequisites

- **Node.js 20+** (22+ recommended — the viewer runs Next.js 15 / React 19).
- **git** (optional, but enables churn/hotspot signals from local history).
- **For narration only:** the [Claude Code](https://claude.com/claude-code) CLI
  (`claude`) installed and authenticated. The graph itself needs no LLM; the
  *narrator* answers by driving a local Claude Code session (see
  [NARRATOR.md](./NARRATOR.md)).

---

## Installation

### 1. Build the graph (core + mcp)

```bash
git clone https://github.com/syntaxpriest/openvisio-oss.git
cd OpenVisio
npm install          # installs the core + mcp workspaces
npm run build        # builds @openvisio/core, then the openvisio CLI → mcp/dist/cli.js
```

Smoke-test it:

```bash
node mcp/dist/cli.js skeleton . --budget=1500
```

For a source build, invoke the CLI by its built path (a global install from
source can't resolve the `@openvisio/core` workspace dependency). To get a short
command, alias it:

```bash
alias openvisio="node $(pwd)/mcp/dist/cli.js"
openvisio skeleton .
```

The published package can be installed globally instead: `npm i -g openvisio`.

### 2. Run the viewer (frontend)

The viewer shells out to `mcp/dist/cli.js` to index repos, so **build the graph
first** (step 1). Then:

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

---

## Quick start

1. **Index a repo.** Open <http://localhost:3000>, point it at a local repo
   path. Indexing is deterministic and LLM-free — it runs `openvisio export`
   under the hood.
2. **Explore.** Switch between the **Narrator**, **Architecture** (nested folder
   graph), **City** (3D), and **Atlas** (whole-codebase) views.
3. **Narrate.** Click **Start agent** in the narrator to spin up the hands-free
   answerer (`openvisio agent`), or keep your own Claude Code session attached.
   Ask a question; the answer is grounded in the graph and cites real files.
4. **Wire the graph into your own agent** (independent of the viewer):

   ```bash
   claude mcp add openvisio -- openvisio mcp /path/to/repo
   ```

See [GRAPH.md](./GRAPH.md) and [NARRATOR.md](./NARRATOR.md) for the full surface.

---

## How the two faces connect

```
            ┌──────────────────────────────────────────────┐
            │  core/  deterministic graph (no LLM, no net)  │
            └───────────────┬───────────────┬──────────────┘
                            │               │
                openvisio export      openvisio mcp / agent
                            │               │  (stdio tools + spotlight SSE :7077)
                            ▼               ▼
                  ┌──────────────┐   ┌──────────────────────┐
                  │  Viewer      │◀─▶│  Claude Code / Codex  │
                  │ (frontend)   │   │  (your coding agent)  │
                  └──────────────┘   └──────────────────────┘
```

- The **viewer** builds its picture from `openvisio export` (pure JSON).
- A coding **agent** talks to `openvisio mcp` over stdio for its 6 query tools.
- With `--spotlight`, the MCP server opens an SSE stream on `127.0.0.1:7077`; an
  open viewer subscribes and lights up the exact files/edges the agent is
  querying — and can push the human's questions back to the agent. This is the
  bridge that powers the Narrator's live answers.

---

## License

MIT — see [LICENSE](../LICENSE).
