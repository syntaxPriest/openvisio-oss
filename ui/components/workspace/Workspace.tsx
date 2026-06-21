'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphResponse, GroupGraphResponse, IndexJob, Language, RepoSummary } from '@/lib/api/types'
import { getLocalGraph, getRemoteGraph, isRemoteSource } from '@/lib/api/local'
import { downloadGraphBundle, readGraphBundle, type GraphBundle } from '@/lib/graph/bundle'
import { topLevelFolder, isRecentlyChanged } from '@/components/graph/encoding'
import { cn } from '@/lib/utils'
import { Snackbar, type ToastItem, type ToastVariant } from '@/components/ui/Snackbar'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { parseView, pathForView, WORKSPACE_BASE, type ViewRoute } from '@/lib/viewRoute'
import { TopBar } from './TopBar'
import { EmptyState } from './EmptyState'
import { IndexingDialog } from './IndexingDialog'
import { ModeTabs, type WorkspaceMode } from './ModeTabs'
import { AtlasView } from '@/components/graph/AtlasView'
import { CityView } from '@/components/city/CityView'

const LAST_REPO_KEY = 'openvisio:lastRepo'

// The City view takes a citations map (used by the agent spotlight in the full
// app). This viewer has no agent, so it's always empty — a stable const avoids
// re-renders from a fresh Map each pass.
const NO_CITATIONS: Map<number, number> = new Map()

type Stage =
  | { kind: 'empty' }
  | { kind: 'indexing'; job: IndexJob | null }
  | { kind: 'ready'; repo: RepoSummary; graph: GraphResponse }

export function Workspace() {
  const [stage, setStage] = useState<Stage>({ kind: 'empty' })
  const [dialogOpen, setDialogOpen] = useState(false)
  // Pending re-index awaiting confirmation (set when a repo is already loaded).
  const [pendingIndexPath, setPendingIndexPath] = useState<string | null>(null)
  const [focusedFileId, setFocusedFileId] = useState<number | null>(null)

  const [languageFilter, setLanguageFilter] = useState<Set<Language>>(new Set())
  const [folderFilter, setFolderFilter] = useState<Set<string>>(new Set())
  const [recentlyChanged, setRecentlyChanged] = useState(false)

  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)
  const [mode, setMode] = useState<WorkspaceMode>('city')
  // Kept only so an exported bundle carries the architecture summary; no view
  // renders it in this viewer.
  const [groupGraph, setGroupGraph] = useState<GroupGraphResponse | null>(null)

  // View ↔ URL: the view we should land on after the graph (re)loads (from the
  // URL on a hard reload), and a one-shot guard for the restore-on-mount.
  const pendingViewRef = useRef<ViewRoute | null>(null)
  const didInitRouteRef = useRef(false)

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (text: string, variant: ToastVariant = 'info') => {
      const id = ++toastIdRef.current
      setToasts((prev) => [...prev, { id, text, variant }].slice(-4))
      window.setTimeout(() => dismissToast(id), variant === 'error' ? 5000 : 3000)
    },
    [dismissToast],
  )

  const indexAbortRef = useRef<AbortController | null>(null)

  const runIndex = useCallback(
    async (source: string) => {
      // Cancel any prior in-flight run before starting a new one.
      indexAbortRef.current?.abort()
      const controller = new AbortController()
      indexAbortRef.current = controller
      setStage({ kind: 'indexing', job: null })
      try {
        // Deterministic local engine (OpenVisio CLI) — no LLM, fast, and the same
        // graph the MCP server serves to coding agents. A Git URL is shallow-cloned
        // server-side first; a local path is indexed in place.
        const remote = isRemoteSource(source)
        const { graph, groupGraph } = remote
          ? await getRemoteGraph(source, undefined, { signal: controller.signal })
          : await getLocalGraph(source, { signal: controller.signal })
        setStage({ kind: 'ready', repo: graph.repo, graph })
        setGroupGraph(groupGraph)
        // Remember the source (URL or path) so a hard reload can restore it.
        try {
          localStorage.setItem(LAST_REPO_KEY, source)
        } catch {
          /* storage unavailable — reload just won't auto-restore */
        }
        setDialogOpen(false)
        setFocusedFileId(null)
        setLanguageFilter(new Set())
        setFolderFilter(new Set())
        setRecentlyChanged(false)
        // Restore the view from the URL (hard reload), else default to City.
        const target = pendingViewRef.current
        pendingViewRef.current = null
        setMode(target ? target.mode : 'city')
      } catch (err) {
        if (controller.signal.aborted) return
        setStage({ kind: 'empty' })
        showToast(err instanceof Error ? err.message : 'Indexing failed', 'error')
      }
    },
    [showToast],
  )

  // Re-indexing replaces the loaded graph + resets the view, so confirm first
  // when a repo is already open. A fresh index (empty) starts immediately.
  const startIndexing = useCallback(
    (rootPath: string) => {
      if (stage.kind === 'ready') setPendingIndexPath(rootPath)
      else void runIndex(rootPath)
    },
    [stage.kind, runIndex],
  )

  // Restore on first mount: a real view path (not "/") + a remembered repo →
  // re-index it and land on that view. "/" shows the open-repo landing.
  useEffect(() => {
    if (didInitRouteRef.current) return
    didInitRouteRef.current = true
    // Arrived from a "/workspace?open=1" link → open the picker, and clean the
    // query so a reload doesn't reopen it.
    if (new URLSearchParams(window.location.search).get('open') === '1') {
      setDialogOpen(true)
      window.history.replaceState(null, '', WORKSPACE_BASE)
    }
    const target = parseView(window.location.pathname)
    if (!target) return
    let saved: string | null = null
    try {
      saved = localStorage.getItem(LAST_REPO_KEY)
    } catch {
      /* storage blocked */
    }
    if (saved) {
      pendingViewRef.current = target
      void runIndex(saved)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect the active view in the URL (replaceState — no remount, so the
  // in-memory graph survives view switches; a hard reload re-reads the path).
  useEffect(() => {
    if (stage.kind !== 'ready' || typeof window === 'undefined') return
    const path = pathForView(mode)
    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path)
    }
  }, [mode, stage.kind])

  const toggleLanguage = useCallback((lang: Language) => {
    setLanguageFilter((prev) => {
      const next = new Set(prev)
      if (next.has(lang)) next.delete(lang)
      else next.add(lang)
      return next
    })
  }, [])

  const toggleFolder = useCallback((folder: string) => {
    setFolderFilter((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }, [])

  const onResetFilters = useCallback(() => {
    setLanguageFilter(new Set())
    setFolderFilter(new Set())
    setRecentlyChanged(false)
  }, [])

  // Esc clears the focused node.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusedFileId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const repo = stage.kind === 'ready' ? stage.repo : null
  const fullGraph = stage.kind === 'ready' ? stage.graph : null

  const availableLanguages = useMemo<Language[]>(() => {
    if (!fullGraph) return []
    return fullGraph.repo.languages.map((l) => l.language)
  }, [fullGraph])

  const availableFolders = useMemo<string[]>(() => {
    if (!fullGraph) return []
    return [...new Set(fullGraph.files.map((f) => topLevelFolder(f.path)))].sort()
  }, [fullGraph])

  // Defer the filter inputs so rapid toggles coalesce: the checkboxes update
  // instantly, but the expensive re-filter + downstream layout only recomputes
  // once the user settles. Keeps a big repo from re-laying-out on every click.
  const liveFilter = useMemo(
    () => ({ languageFilter, folderFilter, recentlyChanged }),
    [languageFilter, folderFilter, recentlyChanged],
  )
  const filter = useDeferredValue(liveFilter)

  const filteredGraph = useMemo<GraphResponse | null>(() => {
    if (!fullGraph) return null
    const { languageFilter: langs, folderFilter: folders, recentlyChanged: recent } = filter
    if (langs.size === 0 && folders.size === 0 && !recent) {
      return fullGraph
    }
    const historyByFile = new Map(fullGraph.history.map((h) => [h.file_id, h]))
    const keep = (f: (typeof fullGraph.files)[number]) => {
      if (langs.size > 0 && !langs.has(f.language)) return false
      if (folders.size > 0 && !folders.has(topLevelFolder(f.path))) return false
      if (recent && !isRecentlyChanged(f, historyByFile.get(f.id))) return false
      return true
    }
    const files = fullGraph.files.filter(keep)
    const fileIds = new Set(files.map((f) => f.id))
    return {
      ...fullGraph,
      files,
      symbols: fullGraph.symbols.filter((s) => fileIds.has(s.file_id)),
      edges: fullGraph.edges.filter((e) => fileIds.has(e.source_id) && fileIds.has(e.target_id)),
      history: fullGraph.history.filter((h) => fileIds.has(h.file_id)),
    }
  }, [fullGraph, filter])

  const onOpen = useCallback(() => setDialogOpen(true), [])

  // ── Load a graph from an exported bundle — no engine, no local repo needed.
  const importGraph = useCallback((bundle: GraphBundle) => {
    indexAbortRef.current?.abort()
    setStage({ kind: 'ready', repo: bundle.graph.repo, graph: bundle.graph })
    setGroupGraph(bundle.groupGraph)
    setDialogOpen(false)
    setFocusedFileId(null)
    setLanguageFilter(new Set())
    setFolderFilter(new Set())
    setRecentlyChanged(false)
    setMode('city')
    // An imported graph isn't tied to a local path on THIS machine — forget any
    // remembered repo so a hard reload doesn't try to re-index a stale path.
    try {
      localStorage.removeItem(LAST_REPO_KEY)
    } catch {
      /* storage blocked */
    }
    showToast('◇ graph imported', 'success')
  }, [showToast])

  const onImportGraphFile = useCallback(
    async (file: File) => {
      try {
        importGraph(await readGraphBundle(file))
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not import graph', 'error')
      }
    },
    [importGraph, showToast],
  )

  const onExportGraph = useCallback(() => {
    if (stage.kind !== 'ready') return
    try {
      downloadGraphBundle(stage.graph, groupGraph)
      showToast('◇ graph exported', 'success')
    } catch {
      showToast('Could not export graph', 'error')
    }
  }, [stage, groupGraph, showToast])

  return (
    <div className={cn('flex h-screen flex-col transition-colors duration-300', mode === 'atlas' && repo ? 'atlas-dark' : null)}>
      <TopBar
        repo={repo}
        languageFilter={languageFilter}
        folderFilter={folderFilter}
        recentlyChanged={recentlyChanged}
        availableLanguages={availableLanguages}
        availableFolders={availableFolders}
        onToggleLanguage={toggleLanguage}
        onToggleFolder={toggleFolder}
        onToggleRecentlyChanged={() => setRecentlyChanged((r) => !r)}
        onResetFilters={onResetFilters}
        onOpenRepo={onOpen}
        onExportGraph={repo ? onExportGraph : undefined}
        onImportGraph={onImportGraphFile}
      />

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1">
          {repo ? (
            <>
              {filteredGraph ? (
                <div className={cn('h-full w-full', mode === 'city' ? 'block' : 'hidden')} aria-hidden={mode !== 'city'}>
                  <CityView
                    graph={filteredGraph}
                    focusedFileId={focusedFileId}
                    citations={NO_CITATIONS}
                    onFocus={setFocusedFileId}
                    active={mode === 'city'}
                  />
                </div>
              ) : null}
              {fullGraph ? (
                <div className={cn('h-full w-full', mode === 'atlas' ? 'block' : 'hidden')} aria-hidden={mode !== 'atlas'}>
                  <AtlasView graph={fullGraph} focusedFileId={focusedFileId} onFocus={setFocusedFileId} active={mode === 'atlas'} />
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState onOpen={onOpen} />
          )}
        </main>
        {repo ? <ModeTabs active={mode} onChange={setMode} disabled={!filteredGraph} /> : null}
      </div>

      <IndexingDialog
        open={dialogOpen}
        job={stage.kind === 'indexing' ? stage.job : null}
        busy={stage.kind === 'indexing'}
        onStart={startIndexing}
        onCancel={() => {
          if (stage.kind === 'indexing') {
            indexAbortRef.current?.abort()
            indexAbortRef.current = null
            setStage({ kind: 'empty' })
            showToast('Indexing cancelled')
          } else {
            setDialogOpen(false)
          }
        }}
      />

      <ConfirmDialog
        open={pendingIndexPath !== null}
        title="Re-index this repo?"
        message="This replaces the currently loaded graph and resets your view."
        confirmLabel="Re-index"
        onConfirm={() => {
          const path = pendingIndexPath
          setPendingIndexPath(null)
          if (path) void runIndex(path)
        }}
        onCancel={() => setPendingIndexPath(null)}
      />

      <Snackbar toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
