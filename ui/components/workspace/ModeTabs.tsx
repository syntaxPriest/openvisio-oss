'use client'

import { Building2, Orbit, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type WorkspaceMode = 'city' | 'atlas'

interface ModeDef {
  id: WorkspaceMode
  label: string
  icon: LucideIcon
  hint: string
}

const MODES: ModeDef[] = [
  { id: 'atlas', label: 'Atlas', icon: Orbit, hint: 'The whole codebase' },
  { id: 'city', label: 'City', icon: Building2, hint: 'Your code as a city' },
]

export interface ModeTabsProps {
  active: WorkspaceMode
  onChange: (mode: WorkspaceMode) => void
  disabled?: boolean
}

export function ModeTabs({ active, onChange, disabled }: ModeTabsProps) {
  return (
    <nav
      aria-label="Workspace modes"
      className="flex h-full w-[60px] shrink-0 flex-col items-center gap-2 border-l border-[color:var(--color-ink-2)] bg-[color:var(--color-ink-0)] py-4"
    >
      {MODES.map(({ id, label, icon: Icon, hint }) => {
        const isActive = id === active
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(id)}
            aria-pressed={isActive}
            aria-label={`${label} – ${hint}`}
            className={cn(
              'group relative grid size-11 place-items-center rounded-2xl transition-all duration-200',
              isActive
                ? 'bg-[#b4480d] text-white shadow-[0_6px_16px_-6px_rgba(180,72,13,0.5)]'
                : 'text-[color:var(--color-ink-5)] hover:bg-[color:var(--color-ink-1)] hover:text-[color:var(--color-ink-8)]',
              'disabled:cursor-not-allowed disabled:opacity-30',
            )}
          >
            <Icon size={19} strokeWidth={1.8} />

            {/* Pointer-events-none tooltip; floats left of the rail. */}
            <span
              aria-hidden
              className="pointer-events-none absolute right-[calc(100%+12px)] top-1/2 z-50 flex -translate-y-1/2 translate-x-1 flex-col gap-0.5 whitespace-nowrap rounded-xl bg-[color:var(--color-ink-8)] px-3 py-2 text-left opacity-0 shadow-[0_10px_28px_-8px_rgba(0,0,0,0.4)] transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
            >
              <span className="text-[12px] font-semibold text-[color:var(--color-ink-0)]">{label}</span>
              <span className="text-[10.5px] text-[color:var(--color-ink-0)]/60">{hint}</span>
              <span
                aria-hidden
                className="absolute right-[-4px] top-1/2 size-2 -translate-y-1/2 rotate-45 bg-[color:var(--color-ink-8)]"
              />
            </span>
          </button>
        )
      })}
    </nav>
  )
}
