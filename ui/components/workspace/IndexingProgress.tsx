'use client'

import { useEffect, useState } from 'react'
import { Check, CircleDot, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface IndexingProgressProps {
  target: string
  message?: string
  onCancel: () => void
}

interface Stage {
  id: string
  label: string
  hint: string
  minSec: number
}

// The deterministic OpenVisio engine doesn't stream progress, so these are
// believable cumulative milestones — `minSec` is roughly how many wall-clock
// seconds in we'd expect that stage to be in flight. Indexing is fast (no LLM):
// most repos finish in seconds; only very large ones reach the later stages.
const STAGES: Stage[] = [
  { id: 'clone', label: 'Fetching repository', hint: 'Local path, or a shallow clone for a Git URL.', minSec: 0 },
  { id: 'scan', label: 'Walking files', hint: 'Listing files and applying exclusion rules.', minSec: 2 },
  { id: 'parse', label: 'Parsing with tree-sitter', hint: 'Extracting symbols from each source file.', minSec: 5 },
  { id: 'analyze', label: 'Resolving imports', hint: 'Tracing module relationships into edges.', minSec: 12 },
  { id: 'rank', label: 'Ranking the graph', hint: 'PageRank centrality over the import graph.', minSec: 20 },
  { id: 'layout', label: 'Computing layout', hint: 'Placing nodes for the City + Atlas views.', minSec: 30 },
]

const HINTS = [
  'Indexing is deterministic and local — no LLM, no network.',
  'GitHub URLs are shallow-cloned to a temp directory first.',
  'Large repos take a little longer; the graph is cached after.',
  'Same repo bytes always produce the same graph.',
]

export function IndexingProgress({ target, message, onCancel }: IndexingProgressProps) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [hintIdx, setHintIdx] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const tick = setInterval(() => setElapsedMs(Date.now() - start), 200)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    const rotate = setInterval(() => setHintIdx((i) => (i + 1) % HINTS.length), 6000)
    return () => clearInterval(rotate)
  }, [])

  const elapsedSec = elapsedMs / 1000
  // Pick the highest stage whose minSec has been reached.
  let currentIdx = 0
  for (let i = 0; i < STAGES.length; i++) {
    if (elapsedSec >= (STAGES[i]?.minSec ?? Infinity)) currentIdx = i
  }

  // Progress bar: smoothly fills toward 92% over the expected duration so
  // the user always sees motion. The last 8% completes when the agent
  // actually returns.
  const estimatedTotal = STAGES[STAGES.length - 1]?.minSec ?? 40
  const pct = Math.min(92, (elapsedSec / estimatedTotal) * 100)

  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
      <div className="flex items-start gap-3">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-[color:var(--color-bg-elev)] text-[color:var(--color-accent)]">
          <Loader2 size={20} strokeWidth={2} className="animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-5)]">
            openvisio engine
          </div>
          <h2 className="mt-0.5 text-[15px] font-semibold leading-tight text-[color:var(--color-ink-8)]">
            Analyzing the codebase…
          </h2>
          <div className="mt-1 truncate font-mono text-[11px] text-[color:var(--color-ink-5)]" title={target}>
            {target}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-5)]">elapsed</div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-[color:var(--color-ink-8)]">
            {formatTime(elapsedMs)}
          </div>
        </div>
      </div>

      {/* Stage list */}
      <ol className="mt-4 flex flex-col gap-1.5">
        {STAGES.map((stage, i) => {
          const status: 'done' | 'active' | 'pending' =
            i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending'
          return (
            <li
              key={stage.id}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors',
                status === 'active' && 'bg-[color:var(--color-bg-elev)]',
              )}
            >
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full',
                  status === 'done' && 'bg-[color:var(--color-accent)] text-white',
                  status === 'active' && 'text-[color:var(--color-accent)]',
                  status === 'pending' && 'text-[color:var(--color-ink-4)]',
                )}
              >
                {status === 'done' ? (
                  <Check size={11} strokeWidth={3} />
                ) : status === 'active' ? (
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                ) : (
                  <CircleDot size={10} strokeWidth={1.6} />
                )}
              </span>
              <span
                className={cn(
                  'flex-1 text-[12.5px] leading-tight',
                  status === 'done' && 'text-[color:var(--color-ink-5)] line-through decoration-[color:var(--color-ink-4)]',
                  status === 'active' && 'font-medium text-[color:var(--color-ink-8)]',
                  status === 'pending' && 'text-[color:var(--color-ink-4)]',
                )}
              >
                {stage.label}
              </span>
              {status === 'active' ? (
                <span className="font-mono text-[10px] text-[color:var(--color-muted)]">
                  {stage.hint}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="h-[3px] overflow-hidden rounded-full bg-[color:var(--color-bg-elev)]">
          <div
            className="h-full rounded-full bg-[color:var(--color-accent)] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-[color:var(--color-ink-5)]">
          <span>{message || HINTS[hintIdx]}</span>
          <span className="tabular-nums">~{Math.round(pct)}%</span>
        </div>
      </div>

      {/* Cancel */}
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--color-ink-8)] transition-colors hover:border-[color:var(--color-hot-2)] hover:text-[color:var(--color-hot-2)]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
