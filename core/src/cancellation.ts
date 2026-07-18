// Cancellation primitives. A caller fires and abandons requests constantly — a
// query for a line the user already scrolled past should be dropped, not executed.
// This mirrors the widely-used CancellationToken shape so an editor's token can be
// wired straight through to a cancel with no adaptation.

export class CancellationError extends Error {
  constructor(message = 'Operation cancelled') {
    super(message)
    this.name = 'CancellationError'
  }
}

export interface Disposable {
  dispose(): void
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean
  /** Register a listener. Fires immediately (synchronously) if already cancelled. */
  onCancellationRequested(listener: () => void): Disposable
  /** Throw {@link CancellationError} if cancellation has been requested. */
  throwIfCancelled(): void
}

class Token implements CancellationToken {
  private cancelled = false
  private readonly listeners = new Set<() => void>()

  get isCancellationRequested(): boolean {
    return this.cancelled
  }

  onCancellationRequested(listener: () => void): Disposable {
    if (this.cancelled) {
      listener()
      return { dispose() {} }
    }
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new CancellationError()
  }

  fire(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const l of this.listeners) {
      try {
        l()
      } catch {
        // A misbehaving listener must not block the others or the canceller.
      }
    }
    this.listeners.clear()
  }
}

/** Owns a token and the sole authority to cancel it (VS Code's model). */
export class CancellationTokenSource {
  private readonly _token = new Token()

  get token(): CancellationToken {
    return this._token
  }

  cancel(): void {
    this._token.fire()
  }
}

/** A token that is never cancelled — a convenient default for callers with none. */
export const NONE: CancellationToken = new CancellationTokenSource().token
