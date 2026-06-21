'use client'

import { FolderOpen } from 'lucide-react'

// The in-app empty screen — shown once the user has entered the workspace but
// hasn't picked a repo yet (or closed the picker). Warm and editorial, matching
// the landing and narrator, so entering the app feels like one continuous space.
export function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden bg-o-paper px-6">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 80% at 50% -10%, rgba(211,231,255,0.3) 0%, transparent 60%)' }}
      />
      <div className="relative w-full max-w-md text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-o-mut">Your workspace</div>
        <h1 className="mt-4 text-[clamp(28px,3.2vw,38px)] font-semibold tracking-tight leading-tight text-o-ink">
          Open a repository to begin.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-[14.5px] leading-relaxed text-o-mut">
          Point OpenVisio at a local repo. Files and folders become a navigable map, and the narrator walks you through
          it — everything stays on your machine.
        </p>
        
        <button
          type="button"
          onClick={onOpen}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-o-ink px-6 py-3 text-[13.5px] font-medium text-white transition-opacity duration-200 hover:opacity-85"
        >
          <FolderOpen size={15} strokeWidth={2} />
          Open a repo
        </button>

        <div className="mt-10 font-mono text-[10px] uppercase tracking-[0.22em] text-o-mut/70">
          local · read-only · grounded narration
        </div>
      </div>
    </div>
  )
}
