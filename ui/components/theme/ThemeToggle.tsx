'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme/ThemeProvider'

/** Light/dark switch for the top bar. Shows the icon of the theme you'd switch TO. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle light/dark theme"
      className="grid size-8 place-items-center rounded-full border border-[color:var(--color-ink-2)] bg-[color:var(--color-ink-0)] text-[color:var(--color-ink-6)] transition-colors hover:border-[color:var(--color-ink-4)] hover:text-[color:var(--color-ink-8)]"
    >
      {dark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
    </button>
  )
}
