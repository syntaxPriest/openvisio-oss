# Token-savings A/B protocol (real agent runs)

The [estimator](./estimate.ts) projects savings from repo bytes. **These are the
real numbers** — measured from actual Claude Code / Codex runs on a target repo,
the only honest source for a README headline. The procedure is deliberately
boring and repeatable.

> Per §9 of the integration doc: *baseline first, then report your own deltas —
> never quote external numbers as if they're OpenVisio's.*

## What you need

- A **large, existing, structured repo** (this is where OpenVisio helps — not a
  toy or greenfield project).
- A built OpenVisio CLI: `npm run build` → `mcp/dist/cli.js`.
- Claude Code and/or Codex.
- 3–5 **representative, exploration-heavy tasks** for that repo — phrase them as
  a developer would (e.g. *"where is rate limiting enforced and what would I
  change to make it per-org?"*). Reuse the shape of [`tasks.frontend.json`](./tasks.frontend.json).

## A — Baseline (no OpenVisio)

For each task, in a **fresh session** (so context starts clean):

1. Start Claude Code in the repo with **no** OpenVisio MCP server attached.
2. Paste the task. Let the agent explore until it can state a concrete plan /
   first edit. **Do not let it edit** — we're measuring *exploration*.
3. Record:
   - `/context` → **input tokens** at the point it's ready to act.
   - **tool-call count** (Read/Grep/Glob/LS) it used to get there.
4. Codex equivalent: `/status` for the token + call counts.

Log each into the table below under "baseline".

## B — With OpenVisio

1. Attach the server (ideally `--watch`):
   ```bash
   claude mcp add openvisio -- node /ABS/PATH/mcp/dist/cli.js mcp /ABS/PATH/repo --watch
   ```
   Codex: add the `[mcp_servers.openvisio]` block (see the package README).
2. **Steer the agent** (system prompt / first message): *"Call `resolve_context`
   with the task before exploring. Read files only when a returned slice is
   insufficient."*
3. Repeat A's steps per task in fresh sessions. Record `/context` input tokens
   and tool-call count at the same "ready to act" point.
4. On server shutdown, note the printed receipt line
   (`openvisio: N tool call(s) · …`) as a cross-check.

## Results

| task | baseline tokens | baseline calls | OpenVisio tokens | OpenVisio calls | token Δ | call Δ |
|---|---|---|---|---|---|---|
| _task 1_ | | | | | | |
| _task 2_ | | | | | | |
| _task 3_ | | | | | | |
| **median** | | | | | | |

Report the **median** (one runaway task shouldn't set the headline). Note the
model, repo size (files / LOC), and date.

## Keeping it honest

- Same tasks, same repo, same model, same "ready to act" stopping rule for both
  arms. Fresh session each time.
- Hold quality constant: if the OpenVisio arm produces a worse plan, say so —
  graph-first trades a few quality points for tokens, and the README should state
  the trade, not hide it.
- Run each task 2–3× and take the median; agent runs are noisy.
- Report a **range**, not a single hero number. "5–15× fewer exploration tokens,
  ~2× fewer tool calls, on <repo>" is a claim you can stand behind.
