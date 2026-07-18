import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Indexer } from '../src/build.js'
import type { CodeGraph } from '../src/types.js'

function tmpRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-rev-'))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

const nodeById = (g: CodeGraph) => {
  const m = new Map<string, number>()
  for (const n of [...g.files, ...g.symbols, ...g.edges]) m.set(n.nodeId, n.revision)
  return m
}
const fileRev = (g: CodeGraph, p: string) => g.files.find((f) => f.path === p)!.revision
const symRev = (g: CodeGraph, name: string) => g.symbols.find((s) => s.name === name)!.revision

test('graphRevision increments by one per reindex; only changed nodes advance', async () => {
  const dir = tmpRepo({
    'a.ts': 'export function alpha(): number { return 1 }\nexport function beta(): number { return 2 }\n',
    'b.ts': 'export function solo(): number { return 3 }\n',
  })
  try {
    const idx = new Indexer(dir, { parseTimeoutMs: 0 })

    // ---- build 1 -----------------------------------------------------------
    const r1 = await idx.reindex()
    assert.equal(r1.graph.revision, 1, 'first reindex → graphRevision 1')
    for (const rev of nodeById(r1.graph).values()) assert.equal(rev, 1, 'all nodes at rev 1')

    // ---- edit: append a new function to a.ts (does not move existing symbols)
    fs.appendFileSync(path.join(dir, 'a.ts'), 'export function gamma(): number { return 42 }\n')
    const r2 = await idx.reindex()

    assert.equal(r2.graph.revision, 2, 'second reindex → graphRevision 2')
    assert.equal(symRev(r2.graph, 'gamma'), 2, 'new symbol advanced')
    assert.equal(fileRev(r2.graph, 'a.ts'), 2, 'edited file advanced (sha changed)')
    assert.equal(symRev(r2.graph, 'alpha'), 1, 'untouched symbol stayed')
    assert.equal(symRev(r2.graph, 'beta'), 1, 'untouched symbol stayed')
    assert.equal(symRev(r2.graph, 'solo'), 1, 'symbol in unchanged file stayed')
    assert.equal(fileRev(r2.graph, 'b.ts'), 1, 'unchanged file stayed')

    // changedNodeIds is EXACTLY the set of nodes now at the new revision.
    const advanced = [...nodeById(r2.graph).entries()].filter(([, r]) => r === 2).map(([id]) => id)
    assert.deepEqual([...r2.changes.changedNodeIds].sort(), advanced.sort())
    assert.ok(r2.changes.changedNodeIds.includes(r2.graph.symbols.find((s) => s.name === 'gamma')!.nodeId))

    // ---- no-op reindex: counter still bumps, nothing changes ---------------
    const r3 = await idx.reindex()
    assert.equal(r3.graph.revision, 3, 'no-op reindex still bumps graphRevision')
    assert.deepEqual(r3.changes.changedNodeIds, [], 'no nodes changed')
    for (const rev of nodeById(r3.graph).values()) assert.notEqual(rev, 3, 'no node at rev 3')

    idx.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a body-only edit advances the file but not the symbol', async () => {
  const dir = tmpRepo({
    'x.ts': 'export function keep(): number {\n  return 1\n}\n',
  })
  try {
    const idx = new Indexer(dir, { parseTimeoutMs: 0 })
    const r1 = await idx.reindex()
    const before = symRev(r1.graph, 'keep')

    // Change the body only — same signature, same line count, same ranges.
    fs.writeFileSync(path.join(dir, 'x.ts'), 'export function keep(): number {\n  return 2\n}\n')
    const r2 = await idx.reindex()

    assert.equal(fileRev(r2.graph, 'x.ts'), 2, 'file advanced (content changed)')
    assert.equal(symRev(r2.graph, 'keep'), before, 'symbol surface unchanged → revision held')
    idx.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
