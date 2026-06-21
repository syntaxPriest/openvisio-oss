'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { Check, Download, FolderOpen, RotateCw, Upload } from 'lucide-react'
import type { RepoSummary, Language } from '@/lib/api/types'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { cn } from '@/lib/utils'

export interface TopBarProps {
  repo: RepoSummary | null
  languageFilter: Set<Language>
  folderFilter: Set<string>
  recentlyChanged: boolean
  availableLanguages: Language[]
  availableFolders: string[]
  onToggleLanguage: (lang: Language) => void
  onToggleFolder: (folder: string) => void
  onToggleRecentlyChanged: () => void
  onResetFilters: () => void
  onOpenRepo: () => void
  /** Download the loaded graph as a portable bundle. Omitted when nothing's loaded. */
  onExportGraph?: () => void
  /** Load a graph from an exported bundle file. */
  onImportGraph?: (file: File) => void
}

// Shared pill styles — soft, rounded, warm on hover.
const PILL =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors duration-150'
const PILL_IDLE =
  'border-[color:var(--color-ink-2)] bg-[color:var(--color-ink-0)] text-[color:var(--color-ink-6)] hover:border-[color:var(--color-ink-4)] hover:text-[color:var(--color-ink-8)]'
const PILL_ON =
  'border-[#e2b07a] bg-[#fbf1e6] text-[#b4480d]'

export function TopBar({
  repo,
  languageFilter,
  folderFilter,
  recentlyChanged,
  availableLanguages,
  availableFolders,
  onToggleLanguage,
  onToggleFolder,
  onToggleRecentlyChanged,
  onResetFilters,
  onOpenRepo,
  onExportGraph,
  onImportGraph,
}: TopBarProps) {
  const filtersActive = languageFilter.size > 0 || folderFilter.size > 0 || recentlyChanged
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-[color:var(--color-ink-2)] bg-[color:var(--color-ink-0)] px-5 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-70" title="OpenVisio home" aria-label="OpenVisio home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/openvisio.svg" alt="OpenVisio" className="size-10" />
        </Link>
        {repo ? (
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="truncate text-[15px] font-semibold tracking-tight text-[color:var(--color-ink-8)]">
              {repo.name}
            </span>
            <span className="shrink-0 text-[11.5px] text-[color:var(--color-ink-5)]">
              {repo.file_count} files · {repo.total_loc.toLocaleString()} lines
            </span>
          </div>
        ) : (
          <span className="text-[13px] text-[color:var(--color-ink-5)]">No repo loaded</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {repo ? (
          <div className="flex items-center gap-1.5">
            <FilterMenu
              label="Language"
              options={availableLanguages.map((l) => ({ value: l, label: l }))}
              selected={new Set([...languageFilter] as string[])}
              onToggle={(v) => onToggleLanguage(v as Language)}
            />
            <FilterMenu
              label="Folder"
              options={availableFolders.map((f) => ({ value: f, label: f }))}
              selected={folderFilter}
              onToggle={onToggleFolder}
            />
            <button
              type="button"
              onClick={onToggleRecentlyChanged}
              className={cn(PILL, recentlyChanged ? PILL_ON : PILL_IDLE)}
            >
              Recently changed
            </button>
            {filtersActive ? (
              <button
                type="button"
                onClick={onResetFilters}
                className="grid size-7 place-items-center rounded-full text-[color:var(--color-ink-5)] transition-colors hover:bg-[color:var(--color-ink-1)] hover:text-[color:var(--color-ink-8)]"
                aria-label="Reset filters"
                title="Reset filters"
              >
                <RotateCw size={13} strokeWidth={2} />
              </button>
            ) : null}

            <span className="mx-1 h-5 w-px bg-[color:var(--color-ink-2)]" />
          </div>
        ) : null}

        {/* Graph portability — export the loaded graph, or import a saved one. */}
        {onExportGraph ? (
          <button type="button" onClick={onExportGraph} className={cn(PILL, PILL_IDLE)} title="Export this graph to a file">
            <Download size={13} strokeWidth={2} />
            <span>Export</span>
          </button>
        ) : null}
        {onImportGraph ? (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(PILL, PILL_IDLE)}
              title="Import a graph from a file"
            >
              <Upload size={13} strokeWidth={2} />
              <span>Import</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onImportGraph(file)
                e.target.value = '' // let the same file be re-imported later
              }}
            />
          </>
        ) : null}

        <ThemeToggle />

        <button
          type="button"
          onClick={onOpenRepo}
          className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-ink-8)] px-3.5 py-1.5 text-[12px] font-medium text-[color:var(--color-ink-0)] transition-opacity duration-150 hover:opacity-85"
        >
          <FolderOpen size={13} strokeWidth={2} />
          {repo ? 'Open another repo' : 'Open a repo'}
        </button>
      </div>
    </header>
  )
}

function FilterMenu({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  const on = selected.size > 0
  return (
    <details className="group relative">
      <summary className={cn(PILL, 'cursor-pointer select-none list-none', on ? PILL_ON : PILL_IDLE)}>
        {label}
        {on ? <span className="grid size-4 place-items-center rounded-full bg-[#b4480d] text-[9px] font-semibold text-white">{selected.size}</span> : null}
      </summary>
      <div className="absolute right-0 z-20 mt-1.5 max-h-72 w-[230px] overflow-y-auto rounded-2xl border border-[color:var(--color-ink-2)] bg-[color:var(--color-ink-0)] p-1.5 shadow-[0_16px_44px_-18px_rgba(0,0,0,0.25)]">
        {options.length === 0 ? (
          <div className="px-2.5 py-2 text-[12px] text-[color:var(--color-muted)]">No options</div>
        ) : (
          options.map((o) => {
            const isOn = selected.has(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onToggle(o.value)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                  isOn ? 'text-[#b4480d]' : 'text-[color:var(--color-ink-7)] hover:bg-[color:var(--color-ink-1)]',
                )}
              >
                <span
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-md border transition-colors',
                    isOn ? 'border-[#b4480d] bg-[#b4480d] text-white' : 'border-[color:var(--color-ink-3)]',
                  )}
                >
                  {isOn ? <Check size={11} strokeWidth={3} /> : null}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            )
          })
        )}
      </div>
    </details>
  )
}
