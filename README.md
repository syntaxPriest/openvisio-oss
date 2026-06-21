# OpenVisio — see any codebase as a graph

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/openvisio?logo=npm)](https://www.npmjs.com/package/openvisio)
[![GitHub stars](https://img.shields.io/github/stars/syntaxpriest/openvisio-oss?style=social)](https://github.com/syntaxpriest/openvisio-oss)
[![CI](https://github.com/syntaxpriest/openvisio-oss/actions/workflows/ci.yml/badge.svg)](https://github.com/syntaxpriest/openvisio-oss/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

> One deterministic code graph, two faces: a **token-cheap MCP query surface** for
> coding agents, and a **local-first visual map** for humans. No LLM in the engine,
> no network, your code never leaves your machine.

OpenVisio parses any repository with tree-sitter into a symbol + import graph,
ranks it with PageRank, and serves it two ways:

- **For your agent** — an [MCP](https://modelcontextprotocol.io) server (`openvisio`
  on npm) that gives Claude Code / Codex / Cursor a ranked, elided, token-budgeted
  view so they query *structure* instead of crawling files.
- **For you** — a local viewer that draws the same graph as an **Atlas** (a
  navigable structural map) and a **City** (a 3D treemap where size and weight
  encode complexity), so you can see the shape of an unfamiliar repo at a glance.

The graph is **deterministic and LLM-free**: same repo bytes → same graph, same
ids, every run.

---

## Install the agent tool

```bash
npm install -g openvisio
cd your-project
openvisio
```

`openvisio` writes the project-scoped MCP configs (`.mcp.json` for Claude Code,
plus `.cursor/mcp.json` / `.vscode/mcp.json` when present) and runs a first index.
Open your agent in the folder, approve the `openvisio` server, and it queries the
code graph instead of reading files blindly.

Full CLI + tool reference: [`mcp/README.md`](mcp/README.md).

### What the agent gets

| tool | what it does |
|------|--------------|
| `resolve_context` | task-ranked skeleton + neighborhoods of the most relevant files (call first) |
| `get_repo_skeleton` | the whole ranked repo map |
| `find_symbol` | locate a function/class/type → signature + `path:line` |
| `get_neighborhood` | local import subgraph around a file/symbol |
| `get_dependents` | who imports this (impact analysis) |
| `get_hotspots` | churn × centrality refactor/risk candidates |

Every line carries a `path:line` anchor, so agents read only the slice they need.
See [`bench/`](bench/) for the token-savings methodology and an A/B protocol.

---

## Run the viewer

The viewer is a local-first Next.js app. It indexes a repo with the same engine
and renders the **Atlas** and **City** views.

```bash
npm run build        # build the engine + CLI first (the viewer indexes with it)
cd ui
npm install
npm run dev          # http://localhost:3000
```

Point it at a local folder or a Git URL; everything is indexed and rendered on
your machine.

---

## Repo layout

| Path | What it is |
|------|------------|
| [`core/`](core/) | `@openvisio/core` — the deterministic code-graph engine (tree-sitter parse, import resolution, PageRank, token-budgeted skeletons). |
| [`mcp/`](mcp/) | `openvisio` — the published MCP server + CLI. Bundles `core` into a single self-contained binary. |
| [`ui/`](ui/) | The local-first viewer (Atlas + City). |
| [`bench/`](bench/) | Token-savings estimator + A/B measurement protocol. |
| [`docs/`](docs/) | Engine, graph, and MCP integration notes. |

---

## Develop

Requires **Node 20+**.

```bash
npm install          # installs the core + mcp workspaces
npm run build        # build @openvisio/core, then bundle the openvisio CLI
npm run typecheck
npm run smoke        # end-to-end CLI smoke test
```

The viewer (`ui/`) installs independently — see [Run the viewer](#run-the-viewer).

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © OpenVisio contributors
