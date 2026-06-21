# The OpenVisio Graph

> A token-cheap, graph-native query surface over a local repo for coding agents.

The OpenVisio graph is the open-source, **local-first, read-only, no-network**
half of the project: a deterministic code-graph engine (`core/`) and the CLI +
MCP server that serves it (`mcp/`). It builds a real graph of your codebase —
tree-sitter symbols, resolved import edges, PageRank centrality, git churn — and
hands an agent a **ranked, elided, token-budgeted** view so Claude Code / Codex
query *structure* instead of crawling files whole.

There is **no LLM and no network access** anywhere in the graph. It only reads
your files and answers questions about their structure.

- Engine source: `core/` (package `@openvisio/core`)
- CLI + MCP server: `mcp/` (binary `openvisio`) — see also the package README at
  [`../mcp/README.md`](../mcp/README.md)

---

## What it produces

`core` parses a repo into a `CodeGraph`:

- **Files** — path, language, lines of code, content SHA, last-modified.
- **Symbols** — functions, classes, interfaces, types, consts — with signatures,
  `path:line` ranges, and an `exported` flag.
- **Edges** — `import` (file → file, resolved) and `call` (symbol → symbol,
  heuristic) with weights.
- **Centrality** — PageRank over the import graph (deterministic: fixed damping
  + iteration count), so "load-bearing" files rank to the top.
- **Churn** — commits in the last 30/90 days + author counts, read from local git
  history when present.

Everything is deterministic: stable numeric ids (assigned in sorted path order),
same repo → same scores. A content-addressed **parse cache** re-parses only
changed files, which makes `--watch` re-indexing cheap and keeps file ids stable
mid-session.

**Languages:** TypeScript, JavaScript, Python, Go, Rust, Java (via tree-sitter
WASM grammars). Markdown / JSON / YAML and other assets are tracked as files but
not symbol-parsed.

---

## Install

### From source (this repo)

```bash
# from the repo root
npm install        # installs the core + mcp workspaces
npm run build      # → mcp/dist/cli.js
```

Run it directly with the absolute path to the built CLI:

```bash
node /abs/path/to/OpenVisio/mcp/dist/cli.js skeleton .
```

(A source build resolves `@openvisio/core` through the workspace, so prefer
invoking `mcp/dist/cli.js` directly rather than a global install. To get a short
`openvisio` command, alias it: `alias openvisio="node /abs/path/to/OpenVisio/mcp/dist/cli.js"`.)

### As a package

```bash
npm install -g openvisio     # then: openvisio ...
# or run without installing:
npx -y openvisio skeleton .
```

Requires **Node 20+**.

---

## CLI

```bash
# Print the ranked, token-budgeted repo skeleton (no MCP — inspect the asset).
openvisio skeleton [path] --budget=1500 [--task="add oauth login"]

# Emit the deterministic graph as JSON (what the viewer consumes).
openvisio export [path] [--out=graph.json]

# Serve the graph to an MCP client over stdio.
openvisio mcp [path]

# …staying fresh as you edit (incremental re-index) and/or lighting up an open
# viewer as the agent queries (SSE on :7077).
openvisio mcp [path] --watch --spotlight [--port=7077]

# Hands-free: run the spotlight server AND auto-answer a viewer's questions with
# a headless Claude Code session (read-only). Powers the viewer's "Start agent".
openvisio agent [path] [--port=7077]
```

| Command | Flags | What it does |
|---|---|---|
| `skeleton` | `--budget=N` (1500), `--task="…"` | Ranked repo map to stdout; `--task` personalizes the ranking. |
| `export` | `--out=FILE` | Writes `{ graph, groupGraph }` JSON (stdout if no `--out`). |
| `mcp` | `--watch`, `--spotlight`, `--port=N` (7077) | Serves the 6 tools over stdio; `--watch` re-indexes on edit; `--spotlight` opens the SSE bridge. |
| `agent` | `--port=N` (7077) | Spotlight server + a poll loop that answers viewer **questions** via `claude -p` (read-only). |

`path` defaults to the current directory.

---

## MCP tools

Tiny by design — tool schemas load into the agent's context every turn, so a fat
surface re-creates the bloat we're eliminating. Every tool takes a
`budget_tokens` and returns ranked, elided output with exact `path:line` anchors.

| Tool | What it does |
|---|---|
| `resolve_context` | Task description → ready-to-work context in ONE call: task-ranked skeleton + the neighborhoods of the most relevant files. **Call first on any task.** |
| `get_repo_skeleton` | Ranked map of the repo: most import-central files + their public symbols. |
| `find_symbol` | Locate a definition by `name`/`pattern`: signature + anchor + elided body. No whole-file reads. |
| `get_neighborhood` | Local import subgraph around a file/symbol (dependents + dependencies to a `depth`), with signatures. |
| `get_dependents` | Directed impact analysis: who imports a target (`direction=dependencies` → what it imports). |
| `get_hotspots` | Load-bearing / risky files: high import centrality (+ git churn when available). |

With `--spotlight`, two extra tools are registered so a viewer and agent can talk:
`get_user_request` (drain a human's instruction from the viewer queue) and
`submit_answer` (push the agent's reply back to the viewer).

On shutdown the server prints a one-line savings receipt — tokens returned vs the
estimated cost of having read the touched files whole.

---

## Connect it to your agent

### Claude Code

```bash
claude mcp add openvisio -- openvisio mcp /path/to/repo
```

### Codex (`~/.codex/config.toml` or project config)

```toml
[mcp_servers.openvisio]
command = "openvisio"
args = ["mcp", "/path/to/repo"]
```

Both connect over stdio — no API keys, no network. If `openvisio` isn't installed
globally, use `npx -y openvisio` as the command, or point at a source build by its
absolute path:

```bash
claude mcp add openvisio -- node /abs/path/to/OpenVisio/mcp/dist/cli.js mcp /path/to/repo
```

**Prompt your agent:**

> On any task, call `resolve_context` with what you're about to do — it returns a
> task-ranked skeleton plus the neighborhoods of the most relevant files in one
> shot. Then use `find_symbol`, `get_neighborhood`, and `get_dependents` to drill
> in, and `get_hotspots` to find load-bearing code. Read source files only when a
> returned slice is insufficient — every result carries a `path:line` anchor.

---

## Spotlight — watch your agent work

Run `openvisio mcp --spotlight` (or `openvisio agent`) and the server exposes a
local SSE stream on `127.0.0.1:7077`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/spotlight` | GET | SSE stream of highlight + queued/consumed/answer events |
| `/api/request` | POST | Enqueue a viewer instruction → `201 {id}` |
| `/api/request` | GET | Peek the next pending instruction (add `?consume=1` to take it) |
| `/health` | GET | Liveness → `200 {ok:true, pid}` |

Each tool call broadcasts the files + import edges the agent is looking at. An
open OpenVisio viewer auto-connects (it health-probes the port first, so it stays
quiet when nothing is running) and highlights the same nodes. The viewer works
fine with no stream; the MCP server works fine with no viewer — it's purely
additive, and bound to `127.0.0.1` only.

---

## Hooks (enforce graph-first, zero copy-paste)

`mcp/hooks/` ships two optional Claude Code hooks — wire them into a repo's
`.claude/settings.json`:

- **`openvisio-gate.mjs`** (`PreToolUse`) — blocks `Read`/`Grep`/`Glob`/`Bash`
  until an `openvisio` tool has primed the session, so the agent consults the
  graph *first*. After priming, everything passes.
- **`openvisio-instruct.mjs`** (`UserPromptSubmit`) — pulls a pending instruction
  from the spotlight server and injects it as context on the next prompt, so a
  question typed in the viewer reaches the agent with no copy-paste. Fails open
  when no spotlight server is running. Honors `OPENVISIO_SPOTLIGHT_PORT`.

---

## Does it actually save tokens?

Two ways to check, in [`../bench/`](../bench) (`npm run bench` from the root):

1. **Estimator** — a deterministic projection from real repo bytes: per task it
   compares one `resolve_context` call against the tokens a no-graph agent would
   read (files matching the task's keywords + the files they import, read whole).
2. **A/B protocol** — [`../bench/PROTOCOL.md`](../bench/PROTOCOL.md) — measured
   `/context` token + tool-call deltas from real Claude Code / Codex runs,
   baseline vs OpenVisio-attached. This is the honest headline source.

> Wins are concentrated in **large, structured repos**. Greenfield or tiny repos
> see little benefit. The graph supplies *understanding*; your agent harness does
> the edits — the server never writes code, runs scans, or makes network calls.
