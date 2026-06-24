import { useEffect, useState } from 'react'
import { FolderSearch, Keyboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IndexingProgress } from './IndexingProgress'
import { FolderBrowser } from './FolderBrowser'

export interface IndexingDialogProps {
  open: boolean
  initialPath?: string
  busy: boolean
  error?: string | null
  onStart: (rootPath: string) => void
  onCancel: () => void
}

export function IndexingDialog({ open, initialPath, busy, error, onStart, onCancel }: IndexingDialogProps) {
  const [path, setPath] = useState(initialPath ?? '')
  // Default to the folder browser — "click index and the folder picker comes up".
  const [mode, setMode] = useState<'type' | 'browse'>('browse')

  // Keep the field in sync when the dialog is (re)opened for a known repo.
  useEffect(() => {
    if (open) setPath(initialPath ?? '')
  }, [open, initialPath])

  if (!open) return null

  const start = () => {
    if (path.trim().length === 0) return
    onStart(path.trim())
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 backdrop-blur-sm">
      <div className={cn('max-w-full', mode === 'browse' && !busy ? 'w-[640px]' : 'w-[560px]')}>
        {busy ? (
          <IndexingProgress target={path.trim() || (initialPath ?? '')} onCancel={onCancel} />
        ) : (
          <div
            className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6"
            style={{ boxShadow: '0 30px 80px -24px rgba(0,0,0,0.42)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] tracking-[0.2em] text-[color:var(--color-ink-5)] uppercase font-mono mb-3">
                  new index
                </div>
                <h2 className="text-[18px] font-semibold tracking-tight text-[color:var(--color-ink-8)]">
                  Analyze a repository.
                </h2>
                <p className="mt-1.5 text-[12px] text-[color:var(--color-ink-5)] leading-relaxed">
                  Point at a <span className="text-[color:var(--color-ink-7)]">local repo path</span>. The
                  deterministic engine indexes it (no LLM, no network) and returns the codebase graph.
                </p>
              </div>

              {/* Type vs. browse toggle */}
              <div className="flex shrink-0 rounded-md border border-[color:var(--color-border)] p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('type')}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
                    mode === 'type'
                      ? 'bg-[color:var(--color-ink-8)] text-[color:var(--color-ink-0)]'
                      : 'text-[color:var(--color-ink-5)] hover:text-[color:var(--color-ink-8)]',
                  )}
                >
                  <Keyboard size={12} strokeWidth={1.75} />
                  type
                </button>
                <button
                  type="button"
                  onClick={() => setMode('browse')}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
                    mode === 'browse'
                      ? 'bg-[color:var(--color-ink-8)] text-[color:var(--color-ink-0)]'
                      : 'text-[color:var(--color-ink-5)] hover:text-[color:var(--color-ink-8)]',
                  )}
                >
                  <FolderSearch size={12} strokeWidth={1.75} />
                  browse
                </button>
              </div>
            </div>

            {mode === 'browse' ? (
              <div className="mt-5">
                <FolderBrowser
                  initialPath={path.trim() || undefined}
                  onSelect={setPath}
                  onConfirm={(p) => {
                    setPath(p)
                    onStart(p)
                  }}
                />
                <p className="mt-1.5 text-[10px] text-[color:var(--color-ink-5)] font-mono">
                  Folders marked <span className="text-[color:var(--color-accent)]">repo</span> contain a{' '}
                  <code>.git</code> directory. Double-click a repo to index it.
                </p>
              </div>
            ) : (
              <>
                <label className="mt-5 block font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-5)]">
                  GitHub repo or local path
                </label>
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') start()
                  }}
                  spellCheck={false}
                  placeholder="github.com/owner/repo   ·   or   /local/path"
                  className={cn(
                    'mt-1.5 block w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-2 font-mono text-[12px] text-[color:var(--color-ink-8)] outline-none',
                    'focus:border-[color:var(--color-ink-7)]',
                  )}
                />
                <p className="mt-1.5 text-[10px] text-[color:var(--color-ink-5)] font-mono">
                  A GitHub URL is fetched + indexed in your browser. A local path is read in
                  place by the CLI — nothing is copied or sent anywhere.
                </p>
              </>
            )}

            {error ? (
              <p className="mt-3 rounded-md border border-[color:var(--color-hot-2)]/40 bg-[color:var(--color-hot-2)]/10 px-3 py-2 font-mono text-[11px] text-[color:var(--color-hot-2)]">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md px-3 py-1.5 text-[11px] tracking-wide font-mono text-[color:var(--color-ink-5)] hover:text-[color:var(--color-ink-8)]"
              >
                cancel
              </button>
              {/* In browse mode the FolderBrowser footer has its own
                  "use this folder" confirm, so skip the duplicate here. */}
              {mode === 'type' ? (
                <button
                  type="button"
                  onClick={start}
                  disabled={path.trim().length === 0}
                  className="rounded-md bg-[color:var(--color-ink-8)] px-3 py-1.5 text-[11px] tracking-wide font-mono text-[color:var(--color-ink-0)] hover:opacity-90 disabled:opacity-40"
                >
                  ↵ index
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
