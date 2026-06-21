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

Once `openvisio` is installed, `view` indexes a repo and opens the bundled
**Atlas** and **City** views in your browser — zero install, served from
`127.0.0.1`:

```bash
openvisio view            # index the current repo and open the viewer
openvisio view ../other   # …or any other local repo
```

The viewer ships in the `openvisio-viewer` package: the same React/Three.js
Atlas + City views, as a self-contained static bundle. Toggle between them, click
to focus a file, and re-index any other local repo from the path box. Nothing
leaves your machine.

**Watch your agent think.** `view` defaults to the spotlight port (7077), so it
doubles as the live-highlight hub: leave it running, point your agent at the repo
with `openvisio mcp . --spotlight`, and each tool call focuses the file it's
looking at — in real time.

From a clone, build the workspace first (`npm run build` builds the engine, the
viewer, and the CLI), then `node mcp/dist/cli.js view .`.

---

## Languages

OpenVisio parses these into symbols and import/call edges (tree-sitter grammars).
Any other text file is still scanned as a graph node — templates (Twig, Blade),
Markdown, and EDA/hardware files (KiCad, Gerber) get a language label without
parsed symbols, so nothing in the repo is invisible.

| Language           | Extensions                          |
| ------------------ | ----------------------------------- |
| TypeScript         | `.ts`, `.mts`, `.cts`               |
| TSX                | `.tsx`                              |
| JavaScript         | `.js`, `.jsx`, `.mjs`, `.cjs`       |
| Python             | `.py`, `.pyi`                       |
| Go                 | `.go`                               |
| Rust               | `.rs`                               |
| Java               | `.java`                             |
| C                  | `.c`, `.h`                          |
| C++                | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`|
| C#                 | `.cs`                               |
| Kotlin             | `.kt`, `.kts`                       |
| Ruby               | `.rb`                               |
| PHP                | `.php`                              |
| Swift              | `.swift` (disabled by default)      |
| Scala              | `.scala`                            |
| Dart               | `.dart`                             |
| Zig                | `.zig`                              |
| Lua                | `.lua`                              |
| R                  | `.r`, `.R`                          |
| Elixir             | `.ex`, `.exs`                       |
| Elm                | `.elm`                              |
| OCaml              | `.ml`, `.mli`                       |
| ReScript           | `.res`                              |
| Solidity           | `.sol`                              |
| TLA+               | `.tla`                              |
| Objective-C        | `.m`, `.mm`                         |
| Bash               | `.sh`, `.bash`                      |
| Vue                | `.vue`                              |
| HTML               | `.html`, `.htm`                     |
| CSS                | `.css`                              |
| JSON               | `.json`                             |
| YAML               | `.yaml`, `.yml`                     |
| TOML               | `.toml`                             |
| Embedded Template  | `.erb`, `.ejs`                      |
| SystemRDL          | `.rdl`                              |
| QL                 | `.ql`                               |
| Emacs Lisp         | `.el`                               |

> Swift's grammar is heavy enough to crash V8's WASM compiler on some machines,
> so it's off by default — enable it with `OPENVISIO_ENABLE_GRAMMARS=swift`.

---

## Repo layout

| Path | What it is |
|------|------------|
| [`core/`](core/) | `@openvisio/core` — the deterministic code-graph engine (tree-sitter parse, import resolution, PageRank, token-budgeted skeletons). |
| [`mcp/`](mcp/) | `openvisio` — the published MCP server + CLI. Bundles `core` into a single self-contained binary. |
| [`viewer/`](viewer/) | `openvisio-viewer` — the bundled Atlas + City app that `openvisio view` serves (React + Three.js, built to a static bundle). |
| [`ui/`](ui/) | Full Next.js web app (Atlas + City + AI narrator). |
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
