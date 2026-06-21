'use client'

// App-wide light/dark theme. The actual colours live in CSS tokens — toggling
// just adds/removes `.theme-dark` on <html>, which flips the neutral chrome
// tokens (see globals.css). Persisted to localStorage; a tiny inline script in
// the root layout applies the stored choice before paint to avoid a flash.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

interface ThemeCtx {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const Ctx = createContext<ThemeCtx | null>(null)
const STORAGE_KEY = 'openvisio:theme'

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('theme-dark', theme === 'dark')
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  // Hydrate from whatever the no-flash script already put on <html> (falling
  // back to storage), so the React state matches the rendered DOM.
  useEffect(() => {
    let initial: Theme = document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light'
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'dark' || saved === 'light') initial = saved
    } catch {
      /* storage blocked */
    }
    setThemeState(initial)
    applyTheme(initial)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    applyTheme(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* storage blocked — theme just won't persist */
    }
  }, [])

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme])

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  // Safe default so components outside the provider (or during SSR) don't crash.
  return ctx ?? { theme: 'light', toggle: () => {}, setTheme: () => {} }
}
