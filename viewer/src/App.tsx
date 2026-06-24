// The open-source viewer shell. Mirrors the app's Workspace wiring — the same
// Atlas and City views, a toggle between them, a focused-file selection, and the
// live agent spotlight — but standalone: it indexes a local repo through the
// `openvisio` server's /api/graph endpoint, with no account, narrator, or AI.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, FolderSearch, Orbit, type LucideIcon } from 'lucide-react'
import { AtlasView } from '@/components/graph/AtlasView'
import { CityView } from '@/components/city/CityView'
import { IndexingDialog } from '@/components/workspace/IndexingDialog'
import { IndexingProgress } from '@/components/workspace/IndexingProgress'
import { GraphResponseSchema, type GraphResponse } from '@/lib/api/types'
import { indexGithubRepo, parseGithubUrl, type FetchProgress } from '@/indexer/github'
import { cn } from '@/lib/utils'

type Mode = 'city' | 'atlas'

interface ModeDef {
  id: Mode
  label: string
  icon: LucideIcon
  hint: string
}

// Atlas first — it's the default landing view (the whole codebase at a glance).
const MODES: ModeDef[] = [
  { id: 'atlas', label: 'Atlas', icon: Orbit, hint: 'The whole codebase' },
  { id: 'city', label: 'City', icon: Building2, hint: 'Your code as a city' },
]

// Human label for the in-browser GitHub fetch/index phases.
function progressLabel(p: FetchProgress): string {
  if (p.phase === 'tree') return 'Reading repository tree…'
  if (p.phase === 'fetch') return `Fetching files… ${p.loaded ?? 0}/${p.total ?? '?'}`
  return 'Parsing in your browser…'
}

export function App() {
  const [source, setSource] = useState<string>(() => new URLSearchParams(location.search).get('path') ?? '')
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [mode, setMode] = useState<Mode>('atlas')
  const [focusedFileId, setFocusedFileId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [agent, setAgent] = useState<'off' | 'idle' | 'live'>('off')
  const [agentTool, setAgentTool] = useState<string>('')

  // No AI narrator here, so nothing is cited — the views take an empty map.
  const citations = useMemo(() => new Map<number, number>(), [])

  const indexRepo = useCallback(async (input: string) => {
    if (!input) return
    setLoading(true)
    setError(null)
    setProgress(null)
    try {
      let g: GraphResponse
      if (parseGithubUrl(input)) {
        // GitHub repo → fetch + index entirely in the browser (no server).
        g = await indexGithubRepo(input, { onProgress: (p) => setProgress(progressLabel(p)) })
      } else {
        // Local path → the `openvisio view` server indexes it (CLI mode).
        const res = await fetch('/api/graph?path=' + encodeURIComponent(input))
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? 'index failed (' + res.status + ')')
        g = GraphResponseSchema.parse(body.graph)
      }
      setGraph(g)
      setFocusedFileId(null)
      setDialogOpen(false) // success — drop the dialog and reveal the map
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGraph(null)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }, [])

  // A transported graph (?g=<id>): fetch the pre-computed graph the CLI uploaded
  // and render it — no indexing here, the work already happened on the machine.
  const transportedId = useMemo(() => new URLSearchParams(location.search).get('g'), [])
  useEffect(() => {
    if (!transportedId) return
    setLoading(true)
    setError(null)
    fetch('/api/import?id=' + encodeURIComponent(transportedId))
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? 'graph not found (' + r.status + ')')
        setGraph(GraphResponseSchema.parse(body.graph))
        setDialogOpen(false)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [transportedId])

  // Index whatever ?path= we booted with (or the user re-indexes via the dialog).
  useEffect(() => { if (source) void indexRepo(source) }, [source, indexRepo])

  // Open the index dialog by hand when there's nothing to show yet (no ?path=,
  // no transported ?g=).
  useEffect(() => { if (!source && !transportedId) setDialogOpen(true) }, [source, transportedId])

  const startIndex = useCallback((repoPath: string) => {
    const p = repoPath.trim()
    if (!p) return
    const url = new URL(location.href)
    url.searchParams.set('path', p)
    history.replaceState(null, '', url)
    setSource(p)
    if (p === source) void indexRepo(p) // same path → effect won't refire; re-run manually
  }, [source, indexRepo])

  // Live agent spotlight — same server, same origin. A tool call's focus[0]
  // drives the focused file so the building/node lights up, exactly like the app.
  const byPath = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of graph?.files ?? []) m.set(f.path, f.id)
    return m
  }, [graph])
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    let es: EventSource
    try { es = new EventSource('/api/spotlight') } catch { return }
    es.addEventListener('spotlight', (ev) => {
      let data: any
      try { data = JSON.parse((ev as MessageEvent).data) } catch { return }
      if (!data || data.v !== 1) return
      if (data.kind && data.kind !== 'highlight') return
      if (data.ts && Date.now() - data.ts > 15000) return
      const first = (data.focus ?? []).map((p: string) => byPath.get(p)).find((id: number | undefined) => id != null)
      if (first != null) setFocusedFileId(first)
      setAgentTool(data.tool || 'agent')
      setAgent('live')
      if (fadeRef.current) clearTimeout(fadeRef.current)
      fadeRef.current = setTimeout(() => setAgent('idle'), 5000)
    })
    es.onopen = () => setAgent((a) => (a === 'live' ? a : 'idle'))
    es.onerror = () => setAgent('off')
    return () => es.close()
  }, [byPath])

  const repo = graph?.repo
  return (
    <div className={cn('flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]', mode === 'atlas' && 'atlas-dark')}>
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-2.5">
        <div className="font-mono text-sm font-semibold">OpenVisio<span className="text-[var(--color-muted)]"> · viewer</span></div>

        {/* Index button — opens the folder browser / path dialog. */}
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-xs text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent)]"
          style={{ maxWidth: 420 }}
        >
          <FolderSearch size={14} strokeWidth={1.75} className="shrink-0 text-[var(--color-muted)]" />
          {source ? (
            <span className="min-w-0 flex-1 truncate text-left text-[var(--color-muted)]">{source}</span>
          ) : (
            <span className="text-[var(--color-muted)]">Index a repo…</span>
          )}
        </button>

        {repo && (
          <div className="hidden whitespace-nowrap font-mono text-xs text-[var(--color-muted)] sm:block">
            <b className="text-[var(--color-fg)]">{repo.file_count}</b> files · <b className="text-[var(--color-fg)]">{repo.total_loc.toLocaleString()}</b> loc
          </div>
        )}
        {agent !== 'off' && (
          <span className={cn('whitespace-nowrap rounded-full border px-2 py-1 font-mono text-[10px]', agent === 'live' ? 'animate-pulse border-amber-500/50 bg-amber-500/10 text-amber-500' : 'border-[var(--color-border)] text-[var(--color-muted)]')}>
            {agent === 'live' ? '● ' + agentTool : '○ stream'}
          </span>
        )}

        {/* Icon mode toggle — Atlas / City. */}
        <div className="ml-auto flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
          {MODES.map(({ id, label, icon: Icon, hint }) => {
            const isActive = id === mode
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={isActive}
                title={`${label} — ${hint}`}
                aria-label={`${label} — ${hint}`}
                className={cn(
                  'grid size-7 place-items-center rounded transition-colors',
                  isActive
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]',
                )}
              >
                <Icon size={16} strokeWidth={1.8} />
              </button>
            )
          })}
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {graph ? (
          mode === 'city' ? (
            <CityView graph={graph} focusedFileId={focusedFileId} citations={citations} onFocus={setFocusedFileId} active />
          ) : (
            <AtlasView graph={graph} focusedFileId={focusedFileId} onFocus={setFocusedFileId} active />
          )
        ) : (
          <div className="grid h-full place-items-center px-6">
            {loading && !dialogOpen ? (
              <div className="w-full max-w-[520px]">
                <IndexingProgress target={source} message={progress ?? undefined} onCancel={() => setLoading(false)} />
              </div>
            ) : error ? (
              <div className="max-w-lg text-center font-mono text-sm text-red-400">Error: {error}</div>
            ) : (
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 font-mono text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                <FolderSearch size={15} strokeWidth={1.9} />
                Index a repo
              </button>
            )}
          </div>
        )}
      </main>

      <IndexingDialog
        open={dialogOpen}
        initialPath={source}
        busy={loading}
        error={error}
        onStart={startIndex}
        onCancel={() => { setDialogOpen(false); setLoading(false) }}
      />
    </div>
  )
}
