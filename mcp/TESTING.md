# OpenVisio MCP — Test Checklist

A practical checklist for verifying the OpenVisio MCP server, the `--spotlight`
reverse channel, the hands-free agent, and the viewer integration. Each item
notes how to check and what to expect.

> Quick triage commands
> ```bash
> curl -s http://127.0.0.1:7077/health; echo        # who owns the port + mode
> tail -f "$TMPDIR/openvisio-agent.log"             # hands-free agent + claude output
> lsof -nP -i :7077                                  # what's listening on the spotlight port
> claude -p "say hi" --allowedTools Read,Grep,Glob   # is headless claude working at all
> ```

## 1. Build & version sanity
- [ ] `cd core && npm run build`, then `cd mcp && npm run build` both succeed — the CLI **bundles** `@openvisio/core`, so a core change isn't live until `mcp/dist/cli.js` is rebuilt.
- [ ] `node mcp/dist/cli.js --help` runs and lists `mcp`, `agent`, `spotlight`, `export`, `init`.
- [ ] The `openvisio` your editor runs is the rebuilt one. `which openvisio` points where you expect (or `OPENVISIO_CLI` is set to `mcp/dist/cli.js`).

## 2. Registration & discovery
- [ ] `openvisio init` writes project `.mcp.json`; `openvisio init --global` updates `~/.claude.json`, `~/.cursor/mcp.json`, etc.
- [ ] Registered command is `openvisio mcp . --watch` (**no `--spotlight`** by default).
- [ ] In Claude Code the openvisio server **connects** and shows **6 tools**: `resolve_context`, `get_repo_skeleton`, `find_symbol`, `get_neighborhood`, `get_dependents`, `get_hotspots`.
- [ ] Server starts in the repo's cwd and indexes it (no crash on a fresh repo).

## 3. The 6 query tools (run each in an MCP session)
- [ ] `resolve_context("<task>")` → task-ranked skeleton + neighborhoods, every line with a `path:line` anchor.
- [ ] `get_repo_skeleton` → full file map.
- [ ] `find_symbol(name / pattern)` → signature + `path:line` + body slice.
- [ ] `get_neighborhood(file/symbol)` → local import subgraph.
- [ ] `get_dependents(symbol/file)` → importers / impact.
- [ ] `get_hotspots` → churn × centrality candidates.
- [ ] Each tool errors gracefully on a bad arg (returns an `Error:` message, no crash).
- [ ] `--watch`: edit a file → subsequent tool calls reflect the change (re-index).

## 4. Reverse channel (`--spotlight` → 8 tools)
- [ ] Run `openvisio mcp . --watch --spotlight` (or add `--spotlight` to the config) → tool count becomes **8**: the 6 above **+ `get_user_request` + `submit_answer`**.
- [ ] `curl -s http://127.0.0.1:7077/health` → `{"ok":true,"pid":…,"mode":"mcp"}`.
- [ ] Queue a viewer question, then `get_user_request` → returns it; `submit_answer(request_id, answer)` → the answer appears in the open viewer.
- [ ] Without `--spotlight`, `get_user_request` / `submit_answer` are **absent** (6 tools) — confirms the opt-in.

## 5. Port / linkSpotlight behavior
- [ ] Two `--spotlight` servers: the second **attaches** (doesn't crash) — `linkSpotlight` forwards over HTTP.
- [ ] A foreign app on 7077 → spotlight **disables** with a clear stderr note; the server still serves the 6 query tools.
- [ ] `--port=<n>` override works (health responds on the new port).

## 6. Hands-free agent (`openvisio agent`)
- [ ] `node mcp/dist/cli.js agent .` binds 7077 and logs "answering viewer questions … (auto-answering with claude)".
- [ ] **Attach mode:** when something already owns 7077 (e.g. a Claude Code `--spotlight` session), the agent **attaches** instead of `EADDRINUSE` — log says "attaching to the mcp/agent spotlight".
- [ ] Ask a question in the viewer Agent tab → terminal logs `answering "…"` → `answered <id>`, and the answer shows in the viewer.
- [ ] **Streaming:** the answer fills in progressively (depends on `claude -p` flushing stdout).
- [ ] **Multiple questions in a row** all get answered — verify #2 / #3 don't stall (the queue-stealing regression).
- [ ] **claude binary:** `claude` not on PATH → clear "could not run claude…" message (not silent); `OPENVISIO_CLAUDE_BIN=$(which claude)` fixes it.
- [ ] **Timeout:** a hung / unauthenticated claude resolves with a "timed out (180s)" message instead of hanging forever (`OPENVISIO_AGENT_TIMEOUT_MS` override works).
- [ ] Agent log lands at `$TMPDIR/openvisio-agent.log` when spawned from the UI ("Start agent").
- [ ] Read-only: claude can't modify files (only `--allowedTools` query tools + Read/Grep/Glob).

## 7. Viewer ↔ MCP integration
- [ ] **Start agent** dropdown (narrator Agent tab) spawns/attaches the agent; the status dot goes grey → starting → green.
- [ ] Narrator **Agent** provider routes questions to the agent and renders the streamed answer (+ a flow-chart).
- [ ] Flow-chart **node click → ask** routes through the chosen engine (agent answers via this path too).
- [ ] Spotlight highlights: when the agent calls a query tool, the viewer pulses the touched files (City / graph).

## 8. Remote / CLI indexing path (uses the MCP CLI)
- [ ] Open a remote repo → the `remote-graph` route runs `mcp/dist/cli.js export` and returns a graph (no crash).
- [ ] A `packages/*` monorepo shows its TS/JS (confirms the scoped-excludes fix flows through the CLI).
- [ ] A huge / binary-heavy repo clones via the blobless + sparse-checkout path without timing out.

## 9. Regression spot-checks
- [ ] Tool count is **6** in a repo whose config has no `--spotlight` (expected state).
- [ ] Editing `core/src/scan.ts` and rebuilding `mcp` actually changes CLI output (bundle picked it up).
- [ ] No stray detached agents linger on 7077 after closing (`lsof -nP -i :7077`).
