# openvisio

[![npm](https://img.shields.io/npm/v/openvisio?logo=npm&color=cb3837)](https://www.npmjs.com/package/openvisio)
[![license](https://img.shields.io/npm/l/openvisio?color=blue)](./LICENSE)
[![node](https://img.shields.io/node/v/openvisio?logo=node.js)](https://nodejs.org)

**See any codebase as a graph.** `openvisio` is an [MCP](https://modelcontextprotocol.io)
server + CLI that hands coding agents (Claude Code, Codex, Cursor, …) a
**token-cheap, ranked, graph-native view** of a repository — so the agent queries
*structure* instead of blindly reading and grepping files.

It parses your repo with tree-sitter into a symbol + import graph, ranks it with
PageRank, and serves task-focused, token-budgeted slices with exact `path:line`
anchors. **Deterministic, local-first, read-only — no LLM in the engine, no
network, your code never leaves your machine.**

```
                    ┌──────────────────────────────┐
                    │        your repository        │
                    └───────────────┬──────────────┘
                                    │  tree-sitter parse
                                    ▼
                    ┌──────────────────────────────┐
                    │     @openvisio/core engine    │
                    │  symbols · imports · PageRank  │
                    │   deterministic · local-only   │
                    └───────────────┬──────────────┘
                                    │  one ranked code graph
                   ┌────────────────┴───────────────┐
                   ▼                                 ▼
        ┌─────────────────────┐          ┌─────────────────────┐
        │     MCP server       │          │      the viewer      │
        │   (for your agent)   │          │       (for you)      │
        │ ranked, token-cheap  │          │   Atlas + City 3D    │
        │  path:line anchors   │          │       map views      │
        └─────────────────────┘          └─────────────────────┘
```

> One graph, two faces: the MCP server is for the agent, the
> [viewer](https://github.com/syntaxpriest/openvisio-oss) is for the human. They
> share the same index.

---

## Why

A coding agent dropped into an unfamiliar repo burns thousands of tokens crawling
files just to learn the shape of things — and still misses how pieces connect.
OpenVisio front-loads that with a deterministic graph, then serves the agent only
the **ranked, elided** slices relevant to its task. The agent reads *less*, and
reads the *right* things, with anchors to jump to the real source when it needs to.

| | read the repo to start | with OpenVisio |
|---|---|---|
| Prime the agent on a repo | ~90K tokens | ~1.5K (`get_repo_skeleton`) |
| Per task | ~80K tokens | ~2.4K (`resolve_context`) |

*Estimates on this project's own viewer package; wins concentrate in large,
structured repos. See [`bench/`](https://github.com/syntaxpriest/openvisio-oss/tree/main/bench)
for the methodology and an A/B protocol.*

---

## Install

```bash
npm install -g openvisio
```

Requires **Node ≥ 18.17**. Tree-sitter grammars and the native cache install with
the package.

## Quick start

Register OpenVisio with your agent for the current project:

```bash
cd your-project
openvisio init            # writes .mcp.json (Claude Code), .cursor/mcp.json, …
openvisio init --global   # or register once for every project
```

Open your agent in the repo, approve the `openvisio` server, and it queries the
graph before touching files. Run the server by hand any time:

```bash
openvisio mcp . --watch
```

---

## What your agent gets

Every tool returns ranked, elided output with exact `path:line` anchors, so the
agent reads only the slice it needs.

| tool | what it does |
|------|--------------|
| `resolve_context` | task description → task-ranked skeleton + the neighborhoods of the most relevant files. **Call this first.** |
| `get_repo_skeleton` | the whole ranked repo map: most import-central files + their public symbols |
| `find_symbol` | locate a function/class/type by name or pattern → signature + anchor |
| `get_neighborhood` | local import subgraph around a file/symbol (dependents + dependencies) |
| `get_dependents` | who imports this — directed impact analysis |
| `get_hotspots` | load-bearing / risky files: high import centrality (+ git churn) |

The tool surface is intentionally tiny — schemas load into the agent's context
every turn, so a fat surface re-creates the bloat we're removing.

---

## CLI

```bash
openvisio [init] [path] [--global] [--cursor]   # register with agents + first index
openvisio mcp [path] [--watch] [--spotlight]    # MCP server over stdio
openvisio view [path] [--port=7077] [--no-open] # open the local graph viewer in a browser
openvisio skeleton [path] [--budget=1500] [--task="add oauth"]  # print the ranked map
openvisio export [path] [--out=.openvisio/graph.json]           # emit the graph as JSON
```

- `--watch` re-indexes incrementally as files change (a content-addressed parse
  cache re-parses only what changed; ids stay stable, so results reflect edits
  mid-session).
- `--task` personalizes the skeleton ranking toward a task description.
- `--spotlight` exposes a local SSE channel so an open OpenVisio viewer lights up
  the files the agent is querying.
- `view` indexes the repo and serves a self-contained, dependency-free graph
  viewer (bundled in the package — nothing to install) on `127.0.0.1`, then opens
  your browser. It draws the same deterministic graph the MCP serves: files
  colored by language, import edges, pan/zoom, search, and a per-language
  breakdown. The path box re-indexes any other local repo. `--no-open` just
  prints the URL. It defaults to the spotlight port (7077) and acts as the
  highlight hub: with `view` running, start your agent with
  `openvisio mcp . --spotlight` and its tool calls pulse the graph live.

---

## Configure your agent manually

Running `openvisio init` does this for you. Manual equivalents:

**Claude Code**
```bash
claude mcp add openvisio -- openvisio mcp . --watch
```

**Cursor / VS Code** — `.cursor/mcp.json` (or `.vscode/mcp.json`):
```json
{
  "mcpServers": {
    "openvisio": { "command": "openvisio", "args": ["mcp", ".", "--watch"] }
  }
}
```

**Codex** — `~/.codex/config.toml`:
```toml
[mcp_servers.openvisio]
command = "openvisio"
args = ["mcp", ".", "--watch"]
```

### Troubleshooting: "MCP server failed to connect" (nvm + GUI editors)

If you installed Node with **nvm** and your MCP client is a **GUI app** (Cursor,
the Claude desktop app), the client spawns servers with a *minimal* PATH that
doesn't include nvm — so bare `openvisio` (or even `node`) isn't found and the
connection fails. Terminal clients (Claude Code CLI, Codex CLI) are unaffected.

Fix: point the config at **absolute paths**:

```jsonc
{
  "mcpServers": {
    "openvisio": {
      "command": "/Users/you/.nvm/versions/node/vXX.Y.Z/bin/node",
      "args": ["/Users/you/.nvm/versions/node/vXX.Y.Z/lib/node_modules/openvisio/dist/cli.js",
               "mcp", ".", "--watch"]
    }
  }
}
```

Find the paths with `which node` and `npm root -g`. (Installing Node from
nodejs.org or Homebrew instead of nvm also avoids this entirely.)

---

## How it works

- **Deterministic & LLM-free** — same repo bytes → same graph, same ids, every run.
- **Local-first & read-only** — reads your code on your machine, never uploads it,
  never modifies the repo.
- **Incremental** — `--watch` keeps the graph fresh as you edit.
- **Broad language support** — TypeScript/JavaScript, Python, Go, Rust, Java, C/C++,
  C#, Ruby, PHP, and many more via tree-sitter.

On shutdown the server prints a one-line savings receipt — tokens returned vs. the
estimated cost of having read the touched files whole.

## Scope

OpenVisio supplies *understanding*; your agent harness does the edits. Wins are
concentrated in large, existing, structured repos; greenfield or tiny repos see
little benefit.

## License

[MIT](./LICENSE) © OpenVisio contributors ·
[github.com/syntaxpriest/openvisio-oss](https://github.com/syntaxpriest/openvisio-oss)
