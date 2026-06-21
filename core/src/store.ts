export interface Store {
  get(key: string): Uint8Array | null
  set(key: string, value: Uint8Array): void
  delete(key: string): void
  /** Drop every entry — used to invalidate a cache built by an older engine. */
  clear(): void
  sync(): void
  close(): void
}
