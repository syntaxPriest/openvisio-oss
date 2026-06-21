// The open-source viewer shell. Mirrors the app's Workspace wiring — the same
// Atlas and City views, a toggle between them, a focused-file selection, and the
// live agent spotlight — but standalone: it indexes a local repo through the
// `openvisio` server's /api/graph endpoint, with no account, narrator, or AI.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AtlasView } from '@/components/graph/AtlasView'
import { CityView } from '@/components/city/CityView'
import { GraphResponseSchema, type GraphResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

type Mode = 'city' | 'atlas'

export function App() {
  const [source, setSource] = useState<string>(() => new URLSearchParams(location.search).get('path') ?? '')
  const [input, setInput] = useState<string>(source)
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [mode, setMode] = useState<Mode>('city')
  const [focusedFileId, setFocusedFileId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agent, setAgent] = useState<'off' | 'idle' | 'live'>('off')
  const [agentTool, setAgentTool] = useState<string>('')

  // No AI narrator here, so nothing is cited — the views take an empty map.
  const citations = useMemo(() => new Map<number, number>(), [])

  const indexRepo = useCallback(async (repoPath: string) => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/graph?path=' + encodeURIComponent(repoPath))
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'index failed (' + res.status + ')')
      setGraph(GraphResponseSchema.parse(body.graph))
      setFocusedFileId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Index whatever ?path= we booted with (or the user re-indexes via the box).
  useEffect(() => { if (source) void indexRepo(source) }, [source, indexRepo])

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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const p = input.trim()
    if (!p) return
    const url = new URL(location.href)
    url.searchParams.set('path', p)
    history.replaceState(null, '', url)
    setSource(p)
  }

  const repo = graph?.repo
  return (
    <div className={cn('flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]', mode === 'atlas' && 'atlas-dark')}>
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-2.5">
        <div className="font-mono text-sm font-semibold">OpenVisio<span className="text-[var(--color-muted)]"> · viewer</span></div>
        <form onSubmit={onSubmit} className="flex min-w-0 flex-1 gap-2" style={{ maxWidth: 560 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="/absolute/path/to/repo"
            className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
          />
          <button type="submit" disabled={loading} className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-xs font-semibold text-white disabled:opacity-50">
            {loading ? 'Indexing…' : 'Index'}
          </button>
        </form>
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
        <div className="ml-auto flex overflow-hidden rounded-md border border-[var(--color-border)] font-mono text-xs">
          {(['city', 'atlas'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn('px-3 py-1.5 capitalize transition-colors', mode === m ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]')}
            >
              {m}
            </button>
          ))}
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
          <div className="grid h-full place-items-center font-mono text-sm text-[var(--color-muted)]">
            {error ? <span className="max-w-lg px-6 text-center text-red-400">Error: {error}</span>
              : loading ? <span>Indexing {source}…</span>
              : <span>Enter a local repo path above and press Index.</span>}
          </div>
        )}
      </main>
    </div>
  )
}
