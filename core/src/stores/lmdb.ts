import { open, type Database } from 'lmdb'
import type { Store } from '../store.js'

export class LmdbStore implements Store {
  private db: Database<Uint8Array, string>

  constructor(path: string) {
    this.db = open({
      path,
      encoding: 'binary',
      keyEncoding: 'binary',
      compression: true,
    })
  }

  get(key: string): Uint8Array | null {
    return this.db.get(key) ?? null
  }

  set(key: string, value: Uint8Array): void {
    this.db.putSync(key, value)
  }

  delete(key: string): void {
    this.db.removeSync(key)
  }

  sync(): void {
    this.db.transactionSync(() => {})
  }

  close(): void {
    this.db.close()
  }
}
