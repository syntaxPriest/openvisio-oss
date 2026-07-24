import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RwLock } from '../src/lock.js'
import { CancellationTokenSource, CancellationError, NONE } from '../src/cancellation.js'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
function defer() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

// ---- RwLock ----------------------------------------------------------------

test('reads run concurrently', async () => {
  const lock = new RwLock()
  let current = 0
  let max = 0
  await Promise.all(
    Array.from({ length: 5 }, () =>
      lock.read(async () => {
        current++
        max = Math.max(max, current)
        await tick()
        current--
      }),
    ),
  )
  assert.ok(max >= 2, `reads should overlap (max concurrency ${max})`)
})

test('writes are exclusive against reads and other writes', async () => {
  const lock = new RwLock()
  let active = 0
  let violation = false
  const guardWrite = () =>
    lock.write(async () => {
      active++
      if (active !== 1) violation = true
      await tick()
      active--
    })
  const guardRead = () =>
    lock.read(async () => {
      // While a writer holds the lock, active must be 0.
      if (active !== 0) violation = true
      await tick()
    })
  await Promise.all([guardWrite(), guardRead(), guardWrite(), guardRead(), guardWrite()])
  assert.equal(violation, false, 'no read/write or write/write overlap')
})

test('two concurrent reads complete while a reindex (write) is queued behind them', async () => {
  const lock = new RwLock()
  const order: string[] = []
  const r1 = defer()
  const r2 = defer()

  const p1 = lock.read(async () => {
    order.push('r1-start')
    await r1.promise
    order.push('r1-end')
  })
  const p2 = lock.read(async () => {
    order.push('r2-start')
    await r2.promise
    order.push('r2-end')
  })

  await tick()
  assert.deepEqual(order, ['r1-start', 'r2-start'], 'both reads started concurrently')

  const w = lock.write(async () => {
    order.push('w-start')
  })
  await tick()
  assert.ok(!order.includes('w-start'), 'write is queued behind the active readers')

  r1.resolve()
  r2.resolve()
  await Promise.all([p1, p2, w])
  assert.deepEqual(order, ['r1-start', 'r2-start', 'r1-end', 'r2-end', 'w-start'])
})

test('a queued writer blocks later readers (no writer starvation)', async () => {
  const lock = new RwLock()
  const order: string[] = []
  const hold = defer()

  const firstRead = lock.read(async () => {
    order.push('read1')
    await hold.promise
  })
  await tick()
  const write = lock.write(async () => order.push('write'))
  const lateRead = lock.read(async () => order.push('read2'))
  await tick()

  hold.resolve()
  await Promise.all([firstRead, write, lateRead])
  // The writer arrived before read2, so it must run first.
  assert.deepEqual(order, ['read1', 'write', 'read2'])
})

test('a throwing critical section releases the lock', async () => {
  const lock = new RwLock()
  await assert.rejects(lock.write(async () => { throw new Error('boom') }), /boom/)
  await assert.rejects(lock.read(async () => { throw new Error('bang') }), /bang/)
  assert.equal(await lock.read(async () => 42), 42, 'lock still usable after errors')
  assert.deepEqual(lock.state, { readers: 0, writer: false, waiting: 0 })
})

// ---- Cancellation ----------------------------------------------------------

test('token reflects cancellation and notifies listeners once', () => {
  const src = new CancellationTokenSource()
  assert.equal(src.token.isCancellationRequested, false)

  let fired = 0
  src.token.onCancellationRequested(() => fired++)
  src.cancel()
  src.cancel() // idempotent

  assert.equal(src.token.isCancellationRequested, true)
  assert.equal(fired, 1, 'listener fires exactly once')
})

test('throwIfCancelled throws only after cancel', () => {
  const src = new CancellationTokenSource()
  src.token.throwIfCancelled() // no-op
  src.cancel()
  assert.throws(() => src.token.throwIfCancelled(), CancellationError)
})

test('listener registered after cancel fires immediately; dispose unregisters', () => {
  const src = new CancellationTokenSource()
  const before = { hit: false }
  const sub = src.token.onCancellationRequested(() => (before.hit = true))
  sub.dispose()
  src.cancel()
  assert.equal(before.hit, false, 'disposed listener does not fire')

  let late = false
  src.token.onCancellationRequested(() => (late = true))
  assert.equal(late, true, 'listener added after cancel fires immediately')
})

test('NONE token is never cancelled', () => {
  assert.equal(NONE.isCancellationRequested, false)
  NONE.throwIfCancelled()
})
