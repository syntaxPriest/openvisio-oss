# bench — does OpenVisio actually save tokens?

Two complementary tools. Use both; trust the second for headline numbers.

## 1. Estimator (fast, deterministic projection)

```bash
npm run bench                      # defaults to ./frontend + tasks.frontend.json
npm run bench -- backend           # any repo path
npx tsx bench/estimate.ts ../some-big-repo --tasks=bench/tasks.mine.json
```

For each task it compares:
- **OpenVisio** = the exact size of one `resolve_context` call, vs.
- **baseline** = the tokens in the files a no-graph agent would actually open
  (files matching ≥2 task keywords, capped, plus the files they import), read
  whole — computed from real repo bytes.

Writes `bench/REPORT.<repo>.md`. It's a **projection, clearly labeled**, and
deliberately conservative (it ignores the per-turn tool-definition tax and
Codex's ~3–5× agent-loop re-processing). It does **not** model answer quality.
On small, dense repos a task's explored set approaches the whole repo — the wins
are real but *concentrated in large repos*, so treat the estimate as shape, not a
transferable absolute.

### Define your own tasks

A tasks file is a JSON array of `{ id, description }`. Phrase descriptions like a
developer would ("add per-org rate limiting to the API gateway"). See
[`tasks.frontend.json`](./tasks.frontend.json).

## 2. A/B protocol (slow, real)

The honest headline source: measured `/context` token + tool-call deltas from
actual Claude Code / Codex runs, baseline vs OpenVisio-attached. See
[PROTOCOL.md](./PROTOCOL.md). Report a median and a range, on a large repo, with
the quality trade stated.

## Why both

The estimator is a sanity check you can run in seconds on any repo; the protocol
is what you quote. They answer the same question at different fidelities — if the
estimator says ~0× on your repo (e.g. greenfield/tiny), don't bother with the
protocol; if it says a lot, go measure it for real.
