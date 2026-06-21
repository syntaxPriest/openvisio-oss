// Token estimation + budget bookkeeping. Exactness isn't the goal — staying
// under a ceiling is. We use the standard ~4-chars-per-token heuristic, which
// is close enough to keep responses small and predictable without pulling in a
// real tokenizer (no heavy deps in the hot path).

/** Cheap token estimate for a string (~4 chars/token, min 1 for non-empty). */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * A running token budget. Callers add items until `wouldExceed` is true, then
 * stop — the canonical "fill by rank, never partially emit a misleading body"
 * pattern from the integration spec lives on top of this.
 */
export class TokenBudget {
  private used = 0
  constructor(public readonly limit: number) {}

  get spent(): number {
    return this.used
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used)
  }

  /** Would adding `text` push us over the limit? (Always allows the first item.) */
  wouldExceed(text: string): boolean {
    if (this.used === 0) return false
    return this.used + estimateTokens(text) > this.limit
  }

  /** Record that `text` was emitted. */
  add(text: string): void {
    this.used += estimateTokens(text)
  }

  /**
   * Try to add `text`: if it fits (or the budget is empty), record and return
   * true; otherwise leave the budget untouched and return false.
   */
  tryAdd(text: string): boolean {
    if (this.wouldExceed(text)) return false
    this.add(text)
    return true
  }
}
