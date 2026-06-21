import type { Metadata } from 'next'
import { Geist, Instrument_Serif, JetBrains_Mono, Newsreader, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

// Variable font (100–900) — the landing's ultra-light display headings sit at 250.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

// Editorial serif for the landing's display headlines (single 400 weight).
const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
})

// Bold grotesk for the hero headline — pairs with the 3D glass renders.
const space = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space',
  display: 'swap',
})

// Warm reading serif for the narrator — an essayist's voice, with italics.
const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-reader',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'OpenVisio — See any codebase as a graph',
  description: 'A local-first code-graph: see any repo as a navigable map, with a grounded narrator that cites the real code.',
  icons: {
    icon: '/openvisio.svg',
  },
}

// Unregister any stale service worker (e.g. left over from another project that
// ran on localhost:3000) + clear its caches. OpenVisio ships no service worker,
// so a registered one only serves outdated pages — this heals it on every load.
const SW_KILL = `
try {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
    if (self.caches && caches.keys) { caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }); }
  }
} catch (e) {}
`

// Apply the saved theme before paint so dark mode never flashes light on load.
const THEME_INIT = `
try {
  if (localStorage.getItem('openvisio:theme') === 'dark') {
    document.documentElement.classList.add('theme-dark');
  }
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jetbrains.variable} ${geist.variable} ${instrument.variable} ${space.variable} ${newsreader.variable}`}>
      <body className="min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: SW_KILL }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
