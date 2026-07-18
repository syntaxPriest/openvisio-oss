import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGraph } from '../src/build.js'
import { offsetToPosition } from '../src/position.js'
import type { CodeGraph } from '../src/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.join(here, 'fixtures', 'repo')

// Build the fixture graph once — grammar loading is the slow part.
// parseTimeoutMs: 0 disables the per-file timeout: the fixture parses instantly,
// and it sidesteps a pre-existing leaked-setTimeout in parseSource that otherwise
// keeps the test process alive ~10s after the last assertion.
let cached: CodeGraph | null = null
async function graphOnce(): Promise<CodeGraph> {
  if (!cached) cached = await buildGraph(repoDir, { parseTimeoutMs: 0 })
  return cached
}

function sourceOf(graph: CodeGraph, fileId: number): string {
  const f = graph.filesById.get(fileId)!
  return fs.readFileSync(path.join(repoDir, f.path), 'utf8')
}

test('T1b: 100% of symbols carry a nameRange that slices to exactly the name', async () => {
  const graph = await graphOnce()
  assert.ok(graph.symbols.length > 0, 'fixture should yield symbols')
  for (const s of graph.symbols) {
    assert.equal(s.nameRange.length, 2, `${s.name}: nameRange is a 2-tuple`)
    assert.equal(s.fullRange.length, 2, `${s.name}: fullRange is a 2-tuple`)
    const src = sourceOf(graph, s.fileId)
    assert.equal(
      src.slice(s.nameRange[0], s.nameRange[1]),
      s.name,
      `${s.name}: nameRange must slice to the identifier`,
    )
    assert.ok(
      s.fullRange[0] <= s.nameRange[0] && s.nameRange[1] <= s.fullRange[1],
      `${s.name}: fullRange must enclose nameRange`,
    )
  }
})

test('T1b: every file has UTF-16 lineStarts beginning at 0', async () => {
  const graph = await graphOnce()
  for (const f of graph.files) {
    assert.ok(f.lineStarts.length >= 1, `${f.path}: has lineStarts`)
    assert.equal(f.lineStarts[0], 0, `${f.path}: lineStarts[0] === 0`)
  }
})

test('T1b: fullRange offsets convert back to the declared start/end lines', async () => {
  const graph = await graphOnce()
  for (const s of graph.symbols) {
    const f = graph.filesById.get(s.fileId)!
    const start = offsetToPosition(f.lineStarts, s.fullRange[0])
    const end = offsetToPosition(f.lineStarts, s.fullRange[1])
    assert.equal(start.line + 1, s.startLine, `${s.name}: fullRange start → startLine`)
    assert.equal(end.line + 1, s.endLine, `${s.name}: fullRange end → endLine`)
  }
})

test('T1b: multibyte content above a symbol does not drift its range', async () => {
  const graph = await graphOnce()
  const beta = graph.symbols.find((s) => s.name === 'beta')
  assert.ok(beta, '`beta` should be extracted')
  const src = sourceOf(graph, beta!.fileId)
  // `beta` is declared after a line with an emoji (surrogate pair), CJK, and an
  // accented char. A byte-based offset would land mid-string; UTF-16 slices clean.
  assert.equal(src.slice(beta!.nameRange[0], beta!.nameRange[1]), 'beta')
  assert.ok(beta!.startLine > 7, '`beta` is below the multibyte line')
})
