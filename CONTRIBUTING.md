# Contributing to OpenVisio

Thanks for your interest! OpenVisio is a deterministic, local-first code-graph
engine + MCP server + viewer. This guide covers the engine/CLI and the viewer.

## Project layout

- `core/` — `@openvisio/core`, the engine (tree-sitter parse → graph → ranking).
- `mcp/` — `openvisio`, the published MCP server + CLI (bundles `core`).
- `ui/` — the local-first viewer (Atlas + City).
- `bench/` — token-savings estimator + A/B protocol.

## Setup

Requires **Node 20+**.

```bash
npm install        # core + mcp workspaces
npm run build      # build core, bundle the CLI
npm run typecheck
npm run smoke      # end-to-end CLI smoke test
```

The viewer installs separately:

```bash
cd ui && npm install && npm run dev
```

## Core principles (please preserve)

- **Deterministic & LLM-free engine.** The graph must be byte-stable: same repo
  bytes → same files, ids, symbols, edges, ranks. No randomness, no network, no
  LLM calls in `core/` or `mcp/`.
- **Local-first & read-only.** The engine reads code on the user's machine and
  never uploads it. MCP tools never modify the repo.
- **Tiny tool surface.** MCP tool schemas load into the agent's context every
  turn — adding a tool has a real token cost. Prefer extending an existing tool.
- **Token-budgeted output.** Tool results are ranked, elided, and carry exact
  `path:line` anchors so agents read only what they need.

## Adding a language

Grammars are tree-sitter `.wasm` files in `core/wasm/`, wired up in
`core/src/parse/treesitter.ts` (the `WASM_FILE` map) and
`core/src/parse/extensions.ts` (extension → grammar mapping). Add the wasm, map
the extension, and add a query for symbol/import extraction.

## Pull requests

1. Fork and branch from `main`.
2. Keep changes focused; match the surrounding code style.
3. `npm run typecheck && npm run build && npm run smoke` must pass.
4. Describe the change and the reasoning in the PR.

By contributing you agree your contributions are licensed under the [MIT
License](LICENSE).
