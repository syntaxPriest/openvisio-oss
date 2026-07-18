import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeSymbolNodeIds, rootIdFor, fileNodeId } from '../src/nodeid.js'
import { buildGraph } from '../src/build.js'
import type { CodeGraph } from '../src/types.js'

const R = 'root0'
const F = 'src/f.ts'
const sym = (name: string, s: number, e: number) => ({ name, fullRange: [s, e] as [number, number] })

// ---- pure unit tests: containment + ordinals -------------------------------

test('top-level symbols with distinct names get suffix-free structural ids', () => {
  const ids = computeSymbolNodeIds(R, F, [sym('alpha', 0, 10), sym('beta', 20, 30)])
  assert.deepEqual(ids, [`${R}::${F}#alpha`, `${R}::${F}#beta`])
})

test('an enclosed symbol is qualified by its container chain', () => {
  // Outer [0,100) contains method [20,40); Mid [10,90) sits between for depth.
  const ids = computeSymbolNodeIds(R, F, [
    sym('Outer', 0, 100),
    sym('Mid', 10, 90),
    sym('leaf', 20, 40),
  ])
  assert.deepEqual(ids, [
    `${R}::${F}#Outer`,
    `${R}::${F}#Outer.Mid`,
    `${R}::${F}#Outer.Mid.leaf`,
  ])
})

test('identical structural paths get stable source-order ordinals', () => {
  const ids = computeSymbolNodeIds(R, F, [sym('twin', 0, 10), sym('twin', 20, 30)])
  assert.deepEqual(ids, [`${R}::${F}#twin@0`, `${R}::${F}#twin@1`])
})

test('same method name in two different classes does NOT collide (no ordinal)', () => {
  const ids = computeSymbolNodeIds(R, F, [
    sym('A', 0, 50),
    sym('run', 10, 20), // A.run
    sym('B', 60, 110),
    sym('run', 70, 80), // B.run
  ])
  assert.deepEqual(ids, [
    `${R}::${F}#A`,
    `${R}::${F}#A.run`,
    `${R}::${F}#B`,
    `${R}::${F}#B.run`,
  ])
})

test('rootIdFor is deterministic, path-sensitive, and 12 hex chars', () => {
  const a = rootIdFor('/Users/me/proj')
  assert.equal(a, rootIdFor('/Users/me/proj'))
  assert.notEqual(a, rootIdFor('/Users/me/other'))
  assert.match(a, /^[0-9a-f]{12}$/)
})

test('fileNodeId format', () => {
  assert.equal(fileNodeId('abc', 'a/b.ts'), 'abc::a/b.ts')
})

// ---- integration: through the real parser + build --------------------------

const here = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.join(here, 'fixtures', 'repo')

test('build assigns well-formed, unique nodeIds to files/symbols/edges', async () => {
  const graph: CodeGraph = await buildGraph(repoDir, { parseTimeoutMs: 0 })
  const rootId = rootIdFor(path.resolve(repoDir))

  for (const f of graph.files) {
    assert.equal(f.nodeId, `${rootId}::${f.path}`)
  }
  // Widget.render must be qualified by its enclosing class.
  const names = graph.symbols.map((s) => s.nodeId)
  assert.ok(
    names.some((id) => id.endsWith('#Widget.render')),
    `expected a #Widget.render id, got: ${names.join(', ')}`,
  )
  assert.ok(names.some((id) => id.endsWith('#alpha')))
  assert.ok(names.some((id) => id.endsWith('#beta')))

  // Uniqueness across all nodes.
  const all = [...graph.files, ...graph.symbols, ...graph.edges].map((n) => n.nodeId)
  assert.equal(new Set(all).size, all.length, 'all nodeIds unique')
  assert.ok(graph.edges.every((e) => e.nodeId.length > 0), 'edges have nodeIds')
})

test('nodeIds are byte-identical across two reindexes of an unchanged repo', async () => {
  const a = await buildGraph(repoDir, { parseTimeoutMs: 0 })
  const b = await buildGraph(repoDir, { parseTimeoutMs: 0 })
  const ids = (g: CodeGraph) =>
    [...g.files, ...g.symbols, ...g.edges].map((n) => n.nodeId).sort()
  assert.deepEqual(ids(a), ids(b))
})
