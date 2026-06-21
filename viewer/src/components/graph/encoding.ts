import type { File, FileHistory, Language } from '@/lib/api/types'

// Every visual channel encodes a real signal. (CLAUDE.md §9)
//   size   — LOC
//   color  — language
//   border — hotspot intensity (commits_90d)
//   edge   — solid=import, dashed=coupling; thickness=weight

const NODE_W_MIN = 156
const NODE_W_MAX = 220
const NODE_H_MIN = 46
const NODE_H_MAX = 58

export function nodeSize(loc: number): { width: number; height: number } {
  const t = Math.min(1, Math.sqrt(loc) / Math.sqrt(300))
  return {
    width: Math.round(NODE_W_MIN + (NODE_W_MAX - NODE_W_MIN) * t),
    height: Math.round(NODE_H_MIN + (NODE_H_MAX - NODE_H_MIN) * t),
  }
}

const LANG_VAR: Record<Language, string> = {
  typescript: 'var(--color-lang-typescript)',
  javascript: 'var(--color-lang-javascript)',
  python: 'var(--color-lang-python)',
  go: 'var(--color-lang-go)',
  rust: 'var(--color-lang-rust)',
  java: 'var(--color-lang-java)',
  ruby: 'var(--color-lang-ruby)',
  c: 'var(--color-lang-c)',
  cpp: 'var(--color-lang-cpp)',
  csharp: 'var(--color-lang-csharp)',
  php: 'var(--color-lang-php)',
  twig: 'var(--color-lang-twig)',
  blade: 'var(--color-lang-blade)',
  kotlin: 'var(--color-lang-kotlin)',
  swift: 'var(--color-lang-swift)',
  scala: 'var(--color-lang-scala)',
  lua: 'var(--color-lang-lua)',
  bash: 'var(--color-lang-bash)',
  html: 'var(--color-lang-html)',
  css: 'var(--color-lang-css)',
  scss: 'var(--color-lang-scss)',
  vue: 'var(--color-lang-vue)',
  svelte: 'var(--color-lang-svelte)',
  dart: 'var(--color-lang-dart)',
  elixir: 'var(--color-lang-elixir)',
  ocaml: 'var(--color-lang-ocaml)',
  solidity: 'var(--color-lang-solidity)',
  zig: 'var(--color-lang-zig)',
  r: 'var(--color-lang-r)',
  elm: 'var(--color-lang-elm)',
  rescript: 'var(--color-lang-rescript)',
  tlaplus: 'var(--color-lang-tlaplus)',
  objc: 'var(--color-lang-objc)',
  embedded_template: 'var(--color-lang-embedded_template)',
  systemrdl: 'var(--color-lang-systemrdl)',
  ql: 'var(--color-lang-ql)',
  elisp: 'var(--color-lang-elisp)',
  markdown: 'var(--color-lang-markdown)',
  json: 'var(--color-lang-json)',
  yaml: 'var(--color-lang-yaml)',
  toml: 'var(--color-lang-toml)',
  sql: 'var(--color-lang-sql)',
  graphql: 'var(--color-lang-graphql)',
  eda: 'var(--color-lang-eda)',
  other: 'var(--color-lang-other)',
}

export function languageColor(language: Language): string {
  return LANG_VAR[language]
}

export function hotspotBorder(history: FileHistory | undefined): {
  width: number
  color: string
} {
  const c = history?.commits_90d ?? 0
  if (c >= 20) return { width: 3, color: 'var(--color-hot-3)' }
  if (c >= 10) return { width: 2, color: 'var(--color-hot-2)' }
  if (c >= 4) return { width: 1.5, color: 'var(--color-hot-1)' }
  return { width: 1, color: 'var(--color-border)' }
}

export function shortName(path: string): string {
  const ix = path.lastIndexOf('/')
  return ix === -1 ? path : path.slice(ix + 1)
}

export function topLevelFolder(path: string): string {
  // Group by two-segment prefix for monorepo layouts (apps/api, apps/web),
  // otherwise by the first segment, otherwise '/'.
  const segs = path.split('/')
  if (segs.length === 1) return '/'
  if (segs.length >= 2 && (segs[0] === 'apps' || segs[0] === 'packages' || segs[0] === 'services')) {
    return `${segs[0]}/${segs[1]}`
  }
  return segs[0] ?? '/'
}

export function folderLabel(folder: string): string {
  if (folder === '/') return 'root'
  return folder
}

export function isRecentlyChanged(file: File, history: FileHistory | undefined): boolean {
  if (!history) return false
  return history.commits_30d > 0
}

// Folder pastel + bold pair — pastel for the container background, bold for
// the folder-name tag tab. Indices in the two arrays match so a folder gets
// a harmonious pair.
const PASTEL_TINTS = [
  '#FFE5D6', // soft peach
  '#D6ECFF', // soft sky
  '#E2F3D6', // soft mint
  '#F0E2FF', // soft lavender
  '#FFF5C8', // soft butter
  '#FFD9E1', // soft rose
  '#D6F2EC', // soft seafoam
]

const BOLD_TINTS = [
  '#EA580C', // orange
  '#0284C7', // sky
  '#16A34A', // green
  '#7C3AED', // violet
  '#CA8A04', // amber
  '#DB2777', // pink
  '#0D9488', // teal
]

function hashFolder(folder: string): number {
  let h = 0
  for (let i = 0; i < folder.length; i++) {
    h = ((h << 5) - h) + folder.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function folderTint(folder: string): string {
  return PASTEL_TINTS[hashFolder(folder) % PASTEL_TINTS.length] ?? PASTEL_TINTS[0] ?? '#FAFAFA'
}

export function folderTab(folder: string): string {
  return BOLD_TINTS[hashFolder(folder) % BOLD_TINTS.length] ?? BOLD_TINTS[0] ?? '#0a0a0a'
}
