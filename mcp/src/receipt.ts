// Per-session savings receipt. Tracks tokens OpenVisio actually returned vs an
// estimated file-exploration baseline (the tokens the agent would have spent
// reading the files it touched, had it crawled them whole). Printed once on
// shutdown. This is an honest estimate, not a measured count — labeled "~est."
//
// Baseline model: a file the agent "would have read" costs ~loc * TOKENS_PER_LOC
// tokens. A file is counted once per session even if several tools referenced it
// (you read a file once). Actual cost is the exact size of text we returned.

import { estimateTokens, type CodeGraph } from '@openvisio/core'

// Code averages well under a full natural-language line; ~8 tokens/line is a
// conservative-to-fair proxy for reading source whole.
const TOKENS_PER_LOC = 8

export class SavingsReceipt {
  private calls = 0
  private actualTokens = 0
  /** Files referenced this session (deduped — read once). */
  private readFiles = new Set<number>()

  // A getter (not a snapshot) so the baseline uses the latest graph under
  // `--watch`, where the graph swaps as files change.
  constructor(private readonly getGraph: () => CodeGraph) {}

  /** Record one tool call: the text we returned + the files it referenced. */
  record(text: string, touchedFiles: number[]): void {
    this.calls++
    this.actualTokens += estimateTokens(text)
    for (const id of touchedFiles) this.readFiles.add(id)
  }

  /** Estimated tokens to have read every touched file whole. */
  private baselineTokens(): number {
    const graph = this.getGraph()
    let total = 0
    for (const id of this.readFiles) {
      const f = graph.filesById.get(id)
      if (f) total += Math.max(1, f.loc) * TOKENS_PER_LOC
    }
    return total
  }

  /** One-line receipt for stderr on shutdown. Null if nothing was queried. */
  summary(): string | null {
    if (this.calls === 0) return null
    const baseline = this.baselineTokens()
    const saved = Math.max(0, baseline - this.actualTokens)
    const ratio = this.actualTokens > 0 ? baseline / this.actualTokens : 0
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`)
    return (
      `openvisio: ${this.calls} tool call(s) · ${k(this.actualTokens)} tokens returned · ` +
      `~${k(saved)} est. tokens saved vs reading ${this.readFiles.size} file(s)` +
      (ratio >= 1.5 ? ` · ~${ratio.toFixed(1)}× leaner` : '')
    )
  }
}
