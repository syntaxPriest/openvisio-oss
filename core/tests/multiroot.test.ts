import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { RootRegistry } from '../src/roots.js'

function tmpRepo(tag: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ov-root-${tag}-`))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

test('two roots register, build, and query independently with no id/edge bleed', async () => {
  const dirA = tmpRepo('a', { 'a.ts': 'export function fromA(): number { return 1 }\n' })
  const dirB = tmpRepo('b', { 'b.ts': 'export function fromB(): number { return 2 }\n' })
  try {
    const reg = new RootRegistry({ buildOptions: { parseTimeoutMs: 0 } })
    const idA = reg.register(dirA)
    const idB = reg.register(dirB)

    assert.notEqual(idA, idB, 'distinct roots → distinct rootIds')
    assert.equal(reg.list().length, 2)
    assert.equal(reg.register(dirA), idA, 'register is idempotent')
    assert.equal(reg.list().length, 2, 're-registering does not duplicate')

    const gA = await reg.build(idA)
    const gB = await reg.build(idB)

    // Content isolation: each graph sees only its own symbols.
    assert.ok(gA.symbols.some((s) => s.name === 'fromA'))
    assert.ok(!gA.symbols.some((s) => s.name === 'fromB'))
    assert.ok(gB.symbols.some((s) => s.name === 'fromB'))
    assert.ok(!gB.symbols.some((s) => s.name === 'fromA'))

    // No id bleed: every node of A is namespaced by idA, every node of B by idB,
    // and the two id sets are disjoint.
    // Every node id carries its own rootId (edges embed both endpoints' ids), and
    // the two id sets are disjoint.
    const idsA = [...gA.files, ...gA.symbols, ...gA.edges].map((n) => n.nodeId)
    const idsB = [...gB.files, ...gB.symbols, ...gB.edges].map((n) => n.nodeId)
    assert.ok(idsA.every((id) => id.includes(idA)), 'A ids namespaced by idA')
    assert.ok(idsB.every((id) => id.includes(idB)), 'B ids namespaced by idB')
    assert.equal(idsA.filter((id) => idsB.includes(id)).length, 0, 'no shared nodeIds')

    reg.closeAll()
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true })
    fs.rmSync(dirB, { recursive: true, force: true })
  }
})

test('unregister removes a root; rootIdForPath is stable and matches register', async () => {
  const dir = tmpRepo('c', { 'c.ts': 'export const v = 1\n' })
  try {
    const reg = new RootRegistry({ buildOptions: { parseTimeoutMs: 0 } })
    const precomputed = reg.rootIdForPath(dir)
    const id = reg.register(dir)
    assert.equal(id, precomputed, 'rootIdForPath predicts the registered id')
    assert.ok(reg.has(id))

    reg.unregister(id)
    assert.ok(!reg.has(id))
    assert.equal(reg.list().length, 0)
    reg.unregister(id) // unregistering an unknown root is a no-op, must not throw
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('reindexing one root does not disturb another', async () => {
  const dirA = tmpRepo('ra', { 'a.ts': 'export function a1(): number { return 1 }\n' })
  const dirB = tmpRepo('rb', { 'b.ts': 'export function b1(): number { return 1 }\n' })
  try {
    const reg = new RootRegistry({ buildOptions: { parseTimeoutMs: 0 } })
    const idA = reg.register(dirA)
    const idB = reg.register(dirB)
    await reg.build(idA)
    await reg.build(idB)

    // Change A, reindex A; B's revision counter is independent.
    fs.appendFileSync(path.join(dirA, 'a.ts'), 'export function a2(): number { return 2 }\n')
    const rA = await reg.reindex(idA)
    const rB = await reg.reindex(idB)

    assert.ok(rA.changes.changedNodeIds.some((id) => id.includes('a2')), 'A saw its new symbol')
    assert.ok(!rB.changes.changedNodeIds.some((id) => id.includes('a2')), 'B unaffected by A edit')
    reg.closeAll()
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true })
    fs.rmSync(dirB, { recursive: true, force: true })
  }
})
