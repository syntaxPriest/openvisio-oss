export interface Store {
  get(key: string): Uint8Array | null
  set(key: string, value: Uint8Array): void
  delete(key: string): void
  sync(): void
  close(): void
}
