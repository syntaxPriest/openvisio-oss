# Testing the OpenVisio MCP layer

Five levels, fastest first. Levels 1–3 are fully automated; 4–5 put it in front
of a real agent / viewer.

## 0. Build

```bash
npm install
npm run build        # builds @openvisio/core then the openvisio CLI
npm run typecheck    # both packages clean
```

## 1. Automated smoke test (≈3s)

Exercises all 6 tools, the spotlight SSE stream, `--watch`, and determinism
against a throwaway repo:

```bash
npm run smoke        # expects "12 passed, 0 failed"
```

## 2. The skeleton asset (Phase 0)

The core asset, no MCP. Eyeball that it's compact, ranked, and anchored:

```bash
npx tsx mcp/src/cli.ts skeleton core --budget=1500
npx tsx mcp/src/cli.ts skeleton frontend --budget=1500 --task="add voice narration"
```

The most import-central files should come first; every symbol carries
`@path:line`; it must fit the budget and be byte-identical across runs.

## 3. Token-savings estimate (the harness)

```bash
npm run bench                         # ./frontend + bench/tasks.frontend.json
npm run bench -- backend              # the Python backend
npx tsx bench/estimate.ts /abs/path/to/your/repo --tasks=bench/tasks.mine.json
```

Writes `bench/REPORT.<repo>.md`. See [`bench/README.md`](../bench/README.md).

## 4. Drive it from Claude Code (the real thing)

```bash
# Point it at any repo you want the agent to work in:
claude mcp add openvisio -- node "$(pwd)/mcp/dist/cli.js" mcp /abs/path/to/repo --watch
```

Then, in Claude Code inside that repo, give it an exploration-heavy task and tell
it: *"Call `resolve_context` first; read files only when a slice is
insufficient."* Watch for:

- `/context` staying small vs. a no-OpenVisio baseline (see
  [`bench/PROTOCOL.md`](../bench/PROTOCOL.md) for the rigorous A/B).
- The agent calling `resolve_context` / `find_symbol` instead of grepping.
- On exit, the server's stderr receipt: `openvisio: N tool call(s) · …`.

To remove it: `claude mcp remove openvisio`.

Codex: add the `[mcp_servers.openvisio]` block from the package README instead.

## 5. The spotlight, end to end (Phase 3, visual)

Needs the Next.js viewer running and a repo indexed in it.

```bash
# terminal 1 — the viewer
cd frontend && npm install && npm run dev      # http://localhost:3000

# terminal 2 — the MCP server with spotlight, on the SAME repo you index in the UI
node mcp/dist/cli.js mcp /abs/path/to/repo --spotlight
```

Open the viewer, index that repo, switch to the City or graph view, then have an
agent (level 4) hit the server. The viewer auto-connects (health-probes :7077
first) and you should see, within ~250ms of each tool call: a toast
(`◎ agent · resolve_context · N files`), the focused buildings/nodes lighting up,
and the queried import edges glowing **amber** in the graph view. The viewer is
unaffected if the spotlight server isn't running.

## Quick reference

| What | Command |
|---|---|
| build / typecheck | `npm run build` · `npm run typecheck` |
| automated smoke | `npm run smoke` |
| skeleton | `npx tsx mcp/src/cli.ts skeleton <path>` |
| savings estimate | `npm run bench -- <path>` |
| serve to an agent | `node mcp/dist/cli.js mcp <path> --watch [--spotlight]` |
