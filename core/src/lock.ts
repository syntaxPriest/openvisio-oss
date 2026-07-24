// Reader/writer lock. The graph is immutable between reindexes, so the model is:
// unlimited concurrent reads, an exclusive write held only during a reindex. No
// real parallelism is needed — just correct mutual exclusion so a caller firing
// many queries at once never observes a half-rebuilt graph.
//
// Fairness is FIFO: waiters are granted in arrival order, with reads batching until
// the next waiter is a writer. That single rule prevents BOTH failure modes — a
// stream of reads can't starve a queued reindex (it waits behind the writer at the
// head), and a stream of writes can't starve reads. This is what lets "two
// concurrent reads complete while a reindex is queued behind them" hold.

type Waiter = { write: boolean; grant: () => void }

export class RwLock {
  private readers = 0
  private writer = false
  private readonly queue: Waiter[] = []

  /** Run `fn` under a shared read lock. Concurrent with other readers. */
  async read<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire(false)
    try {
      return await fn()
    } finally {
      this.readers--
      this.dispatch()
    }
  }

  /** Run `fn` under an exclusive write lock. No reader or writer overlaps it. */
  async write<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire(true)
    try {
      return await fn()
    } finally {
      this.writer = false
      this.dispatch()
    }
  }

  /** Snapshot of lock state, for diagnostics/tests. */
  get state(): { readers: number; writer: boolean; waiting: number } {
    return { readers: this.readers, writer: this.writer, waiting: this.queue.length }
  }

  private acquire(write: boolean): Promise<void> {
    return new Promise<void>((grant) => {
      this.queue.push({ write, grant })
      this.dispatch()
    })
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0]!
      if (next.write) {
        // A writer runs only once every reader has drained and no writer holds.
        if (this.readers > 0 || this.writer) break
        this.queue.shift()
        this.writer = true
        next.grant()
        break // exclusive: nothing else may proceed
      }
      // Reader at the head: cannot proceed while a writer holds the lock.
      if (this.writer) break
      this.queue.shift()
      this.readers++
      next.grant()
      // Loop on to batch further consecutive readers; stops at a queued writer.
    }
  }
}
