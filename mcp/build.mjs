// Bundle the CLI (and @openvisio/core with it) into a single dist/cli.js so
// the published `openvisio` package has no workspace dependency. Real npm deps
// stay external and install normally — web-tree-sitter resolves its .wasm
// grammars from tree-sitter-wasms at runtime via require.resolve, which only
// works when those packages exist on disk.
//
// Requires @openvisio/core to be built first (root: `npm run build`).

import { rmSync } from 'node:fs'
import { build } from 'esbuild'

// Clean: the bundle is the only artifact; stale per-file tsc output must not
// ride along into the published tarball.
rmSync('dist', { recursive: true, force: true })

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: false,
  external: ['@modelcontextprotocol/sdk', 'zod', 'web-tree-sitter', 'tree-sitter-wasms', 'lmdb', 'openvisio-viewer'],
  logLevel: 'info',
}

await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' })

// The npm postinstall hook. Bundled from the CORE-FREE register module, so it
// carries no tree-sitter / lmdb dependency and can't fail an install on a box
// where the native bindings aren't built yet.
await build({ ...common, entryPoints: ['src/postinstall.ts'], outfile: 'dist/postinstall.js' })
