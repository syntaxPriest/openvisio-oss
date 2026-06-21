import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  CornerLeftUp,
  Folder,
  FolderGit2,
  Home,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { browseDirectory, type FsBrowseResult, type FsDirEntry } from '@/lib/api/fs'
import { cn } from '@/lib/utils'

export interface FolderBrowserProps {
  // Directory to open on mount; falls back to the user's home directory.
  initialPath?: string
  // Fired whenever the user highlights a folder (single click).
  onSelect?: (path: string) => void
  // Fired when the user commits to a folder (double click or "Use this folder").
  onConfirm: (path: string) => void
}

export function FolderBrowser({ initialPath, onSelect, onConfirm }: FolderBrowserProps) {
  const [data, setData] = useState<FsBrowseResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const navigate = useCallback(
    (dirPath?: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)
      setSelected(null)
      browseDirectory(dirPath, { signal: controller.signal })
        .then((result) => {
          setData(result)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setError(err instanceof Error ? err.message : 'Failed to read directory')
          setLoading(false)
        })
    },
    [],
  )

  useEffect(() => {
    navigate(initialPath)
    return () => abortRef.current?.abort()
  }, [navigate, initialPath])

  const pick = useCallback(
    (entry: FsDirEntry) => {
      setSelected(entry.path)
      onSelect?.(entry.path)
    },
    [onSelect],
  )

  const crumbs = data ? buildCrumbs(data.path, data.separator) : []

  // Hide hidden/dot folders (.git, .vscode, …) entirely — they're noise when
  // you're picking a repo. (A repo that happens to be hidden still shows.) Then
  // surface actual repos first, ordinary folders after, alphabetical within each.
  const entries = useMemo(() => {
    const list = (data?.entries ?? []).filter((e) => !e.isHidden || e.isGitRepo)
    return list.sort((a, b) => {
      if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
  }, [data])

  return (
    <div className="flex h-[360px] flex-col rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]">
      {/* Toolbar: home / up / refresh + breadcrumb */}
      <div className="flex items-center gap-1 border-b border-[color:var(--color-border)] px-2 py-1.5">
        <button
          type="button"
          title="Home"
          onClick={() => navigate(undefined)}
          className="grid size-6 place-items-center rounded text-[color:var(--color-ink-5)] hover:bg-[color:var(--color-bg)] hover:text-[color:var(--color-ink-8)]"
        >
          <Home size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="Up one level"
          disabled={!data?.parent}
          onClick={() => data?.parent && navigate(data.parent)}
          className="grid size-6 place-items-center rounded text-[color:var(--color-ink-5)] hover:bg-[color:var(--color-bg)] hover:text-[color:var(--color-ink-8)] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <CornerLeftUp size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="Refresh"
          onClick={() => navigate(data?.path)}
          className="grid size-6 place-items-center rounded text-[color:var(--color-ink-5)] hover:bg-[color:var(--color-bg)] hover:text-[color:var(--color-ink-8)]"
        >
          <RefreshCw size={12} strokeWidth={1.75} />
        </button>

        <div className="ml-1 flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap font-mono text-[10.5px] text-[color:var(--color-ink-5)]">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center">
              {i > 0 ? (
                <ChevronRight size={11} className="mx-0.5 shrink-0 text-[color:var(--color-ink-4)]" />
              ) : null}
              <button
                type="button"
                onClick={() => navigate(c.path)}
                className="rounded px-1 py-0.5 hover:bg-[color:var(--color-bg)] hover:text-[color:var(--color-ink-8)]"
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Listing */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid h-full place-items-center text-[color:var(--color-ink-5)]">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center px-6 text-center text-[11px] text-[color:var(--color-hot-2)]">
            {error}
          </div>
        ) : data && entries.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center text-[11px] text-[color:var(--color-ink-5)]">
            No subfolders here.
          </div>
        ) : (
          <ul className="py-1">
            {entries.map((entry) => {
              const isSel = entry.path === selected
              return (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => pick(entry)}
                    onDoubleClick={() =>
                      entry.isGitRepo ? onConfirm(entry.path) : navigate(entry.path)
                    }
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px]',
                      isSel
                        ? 'bg-[color:var(--color-ink-8)] text-[color:var(--color-ink-0)]'
                        : 'text-[color:var(--color-ink-8)] hover:bg-[color:var(--color-bg)]',
                    )}
                  >
                    {entry.isGitRepo ? (
                      <FolderGit2
                        size={14}
                        strokeWidth={1.75}
                        className={isSel ? '' : 'text-[color:var(--color-accent)]'}
                      />
                    ) : (
                      <Folder
                        size={14}
                        strokeWidth={1.75}
                        className={cn(
                          isSel ? '' : 'text-[color:var(--color-ink-5)]',
                          entry.isHidden && 'opacity-60',
                        )}
                      />
                    )}
                    <span className={cn('flex-1 truncate', entry.isHidden && !isSel && 'opacity-60')}>
                      {entry.name}
                    </span>
                    {entry.isGitRepo ? (
                      <span
                        className={cn(
                          'font-mono text-[9px] uppercase tracking-[0.16em]',
                          isSel ? 'text-[color:var(--color-ink-0)]/70' : 'text-[color:var(--color-accent)]',
                        )}
                      >
                        repo
                      </span>
                    ) : (
                      <ChevronRight
                        size={13}
                        className={cn(
                          'shrink-0',
                          isSel ? 'text-[color:var(--color-ink-0)]/70' : 'text-[color:var(--color-ink-4)]',
                        )}
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Footer: selected path + commit */}
      <div className="flex items-center gap-2 border-t border-[color:var(--color-border)] px-2.5 py-2">
        <div
          className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[color:var(--color-ink-5)]"
          title={selected ?? data?.path}
        >
          {selected ?? data?.path ?? ''}
        </div>
        <button
          type="button"
          disabled={!selected && !data?.path}
          onClick={() => {
            const target = selected ?? data?.path
            if (target) onConfirm(target)
          }}
          className="shrink-0 rounded-md bg-[color:var(--color-ink-8)] px-3 py-1.5 text-[11px] tracking-wide font-mono text-[color:var(--color-ink-0)] hover:opacity-90 disabled:opacity-40"
        >
          use this folder
        </button>
      </div>
    </div>
  )
}

interface Crumb {
  label: string
  path: string
}

// Turn an absolute path into clickable breadcrumb segments. Works for both
// POSIX ("/Users/me/x") and Windows ("C:\\Users\\me\\x") separators.
function buildCrumbs(fullPath: string, sep: string): Crumb[] {
  const isPosix = sep === '/'
  const parts = fullPath.split(sep).filter((p) => p.length > 0)
  const crumbs: Crumb[] = isPosix ? [{ label: '/', path: '/' }] : []
  let running = ''
  parts.forEach((part, i) => {
    // POSIX paths are rooted at "/"; Windows paths start at the drive ("C:").
    running = isPosix ? `${running}/${part}` : i === 0 ? part : `${running}${sep}${part}`
    crumbs.push({ label: part, path: running })
  })
  return crumbs
}
