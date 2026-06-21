# OpenVisio token-savings estimate — frontend

> **Projection, not a measured agent run.** Computed from real repo bytes:
> the baseline is the token count of the files a keyword-grep agent would
> open for each task (files matching ≥2 task keywords, capped at 20, plus
> the files they import), read whole.
> The headline numbers in the README must come from real Claude Code / Codex
> runs — see [PROTOCOL.md](./PROTOCOL.md).

Repo: `/Users/MAC/Documents/GitHub/OpenVisio/frontend` · 65 files · 521 symbols · 128 import edges

## Priming (build a whole-repo mental model)

| | tokens |
|---|---|
| Read the whole repo | 92.1K |
| OpenVisio `get_repo_skeleton` | 1.5K |
| **Leaner by** | **62×** |

## Per-task (exploration to start working)

| task | OpenVisio (`resolve_context`) | grep-agent baseline | leaner | files (OV → explored) |
|---|---|---|---|---|
| voice-narration | 2.3K | 80.7K | 35.9× | 11 → 20 grep + 24 imports |
| city-view-highlight | 2.5K | 76.6K | 30.5× | 8 → 20 grep + 22 imports |
| graph-edges-focus | 2.5K | 77.8K | 30.8× | 8 → 20 grep + 21 imports |
| mcp-client | 2.4K | 82.2K | 34.5× | 11 → 20 grep + 26 imports |
| indexing-progress | 2.2K | 78.4K | 36.2× | 13 → 20 grep + 21 imports |
| session-relay | 2.5K | 77.2K | 31.1× | 10 → 20 grep + 19 imports |
| citations | 2.5K | 79.9K | 31.7× | 7 → 20 grep + 22 imports |
| hotspot-filter | 2.5K | 73.6K | 29.2× | 7 → 20 grep + 19 imports |
| **TOTAL** | **19.4K** | **626.4K** | **32.4×** | |

## Method & honesty notes

- Baseline = Σ tokens of files a no-graph agent opens: keyword-grep hits
  (files matching ≥2 distinct task keywords, ranked by breadth, capped at
  20) plus the files those import, each read whole. ~4 chars/token.
- This is **conservative**: real agents often grep more, re-read on misses, and
  re-process context every agent-loop turn (Codex ~3–5×), none of which is
  counted here. It also ignores the per-turn tool-definition tax.
- OpenVisio cost = exact size of `resolve_context` output (one call).
- It does **not** model answer quality. Graph-first trades a few quality points
  for the token saving (see the research doc); the agent can always fall back
  to a real file read via the anchors OpenVisio returns.
- **Repo size matters.** This is a 65-file repo: it is small and densely
  connected, so a task's explored set approaches the whole repo and the per-task
  ratio nears the whole-repo priming ratio. OpenVisio's wins are *concentrated in
  large, structured repos* (per the research doc) — treat this as a lower bound on
  the relative shape, not a transferable absolute. Validate on your real repo via
  [PROTOCOL.md](./PROTOCOL.md).
