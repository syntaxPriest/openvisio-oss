import type { File, FileHistory, GraphResponse, Language } from '@/lib/api/types'
import { topLevelFolder } from '@/components/graph/encoding'

// ---------- Color encodings ----------

export type ColorMode = 'language' | 'file_type' | 'loc' | 'hotness'

export interface ColorModeDef {
  id: ColorMode
  label: string
  hint: string
  kind: 'category' | 'metric'
}

export const COLOR_MODES: ColorModeDef[] = [
  { id: 'language', label: 'Language', hint: 'TypeScript, Python, etc.', kind: 'category' },
  { id: 'file_type', label: 'File type', hint: 'tests, configs, types, docs', kind: 'category' },
  { id: 'loc', label: 'LOC heatmap', hint: 'small → large', kind: 'metric' },
  { id: 'hotness', label: 'Hotness', hint: 'commits in last 30d', kind: 'metric' },
]

// Categorical palettes — language and file_type.
const LANGUAGE_PALETTE: Record<Language, string> = {
  typescript: '#4DA3FF',
  javascript: '#FFD43B',
  python: '#5BA8FF',
  go: '#22D3EE',
  rust: '#FB923C',
  java: '#F472B6',
  ruby: '#F87171',
  c: '#94A3B8',
  cpp: '#F06595',
  csharp: '#51CF66',
  php: '#9AA0E8',
  twig: '#B6D94C',
  blade: '#FB7185',
  kotlin: '#C792EA',
  swift: '#FF9E64',
  scala: '#FB7185',
  lua: '#7AA2F7',
  bash: '#A6E22E',
  html: '#FB923C',
  css: '#A78BFA',
  scss: '#F472B6',
  vue: '#4ADE80',
  svelte: '#FB7185',
  dart: '#2DD4BF',
  elixir: '#C792EA',
  ocaml: '#FBBF24',
  solidity: '#B0AAA2',
  zig: '#F0A868',
  r: '#5B9BE0',
  elm: '#7FD0E0',
  rescript: '#FB7185',
  tlaplus: '#94A3B8',
  objc: '#7AA2F7',
  embedded_template: '#B8B2A6',
  systemrdl: '#A8A29E',
  ql: '#FB923C',
  elisp: '#C792EA',
  markdown: '#C4B5FD',
  json: '#94A3B8',
  yaml: '#FCA5A5',
  toml: '#D6A57E',
  sql: '#F0ABFC',
  graphql: '#F472B6',
  eda: '#C8895A', // copper — PCB traces (KiCad/EAGLE/Gerber)
  other: '#A8A29E',
}

export type FileType = 'source' | 'test' | 'config' | 'types' | 'docs' | 'style' | 'build'

const FILE_TYPE_PALETTE: Record<FileType, string> = {
  source: '#3B82F6', // blue — main source
  test: '#22C55E', // green — tests
  config: '#F59E0B', // amber — config
  types: '#A78BFA', // purple — type definitions
  docs: '#64748B', // slate — docs
  style: '#EC4899', // pink — styles
  build: '#475569', // graphite — build / lockfiles
}

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  source: 'source',
  test: 'tests',
  config: 'config',
  types: 'types',
  docs: 'docs',
  style: 'styles',
  build: 'build',
}

// Reserved metric palettes — these never overlap with categorical encodings.
const LOC_HEATMAP = ['#22C55E', '#FACC15', '#FB923C', '#EF4444', '#7F1D1D'] // green → deep red
const HOTNESS_HEATMAP = ['#CBD5E1', '#60A5FA', '#FACC15', '#FB923C', '#DC2626'] // cold gray → red

export function languageColor(language: Language): string {
  return LANGUAGE_PALETTE[language] ?? LANGUAGE_PALETTE.other
}

export function fileType(path: string, language: Language): FileType {
  const lower = path.toLowerCase()
  if (/\.(test|spec)\.[jt]sx?$/.test(lower)) return 'test'
  if (/(^|\/)(__tests__|tests?|spec|e2e)\//.test(lower)) return 'test'
  if (/\.d\.ts$/.test(lower)) return 'types'
  if (/(^|\/)(tsconfig|next\.config|tailwind\.config|postcss\.config|vite\.config|webpack\.config|jest\.config|babel\.config|eslint\.config)/.test(lower)) return 'config'
  if (/\.(eslintrc|prettierrc|babelrc|gitignore)/.test(lower)) return 'config'
  if (/(^|\/)(package(-lock)?|yarn\.lock|pnpm-lock|bun\.lock|cargo\.lock|go\.sum|requirements\.txt)/.test(lower)) return 'build'
  if (/\.(css|scss|sass|less)$/.test(lower)) return 'style'
  if (language === 'markdown') return 'docs'
  if (language === 'json' || language === 'yaml') return 'config'
  return 'source'
}

export function fileTypeColor(t: FileType): string {
  return FILE_TYPE_PALETTE[t]
}

function interpolatePalette(palette: string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  if (palette.length === 0) return '#000000'
  if (palette.length === 1) return palette[0] ?? '#000000'
  const idx = clamped * (palette.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(palette.length - 1, lo + 1)
  const frac = idx - lo
  return mixHex(palette[lo] ?? '#000000', palette[hi] ?? '#000000', frac)
}

function mixHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16)
  const ag = parseInt(a.slice(3, 5), 16)
  const ab = parseInt(a.slice(5, 7), 16)
  const br = parseInt(b.slice(1, 3), 16)
  const bg = parseInt(b.slice(3, 5), 16)
  const bb = parseInt(b.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`
}

export interface ColorContext {
  maxLoc: number
  maxHotness: number
  historyByFile: Map<number, FileHistory>
}

export function resolveCityColor(file: File, mode: ColorMode, ctx: ColorContext): string {
  if (mode === 'language') return languageColor(file.language)
  if (mode === 'file_type') return fileTypeColor(fileType(file.path, file.language))
  if (mode === 'loc') {
    const t = Math.log(file.loc + 1) / Math.log(Math.max(ctx.maxLoc, 2) + 1)
    return interpolatePalette(LOC_HEATMAP, t)
  }
  if (mode === 'hotness') {
    const h = ctx.historyByFile.get(file.id)?.commits_30d ?? 0
    const t = Math.log(h + 1) / Math.log(Math.max(ctx.maxHotness, 2) + 1)
    return interpolatePalette(HOTNESS_HEATMAP, t)
  }
  return languageColor(file.language)
}

// Default city color = language. Kept for back-compat with old call sites.
export function cityColor(language: Language): string {
  return languageColor(language)
}

// Legend bands for metric modes — used by the legend UI.
export interface LegendBand {
  label: string
  color: string
}

export function metricLegend(mode: ColorMode, ctx: ColorContext): LegendBand[] | null {
  if (mode === 'loc') {
    const max = Math.max(ctx.maxLoc, 1)
    return [
      { label: '0', color: interpolatePalette(LOC_HEATMAP, 0) },
      { label: `${Math.round(max * 0.25)}`, color: interpolatePalette(LOC_HEATMAP, 0.25) },
      { label: `${Math.round(max * 0.5)}`, color: interpolatePalette(LOC_HEATMAP, 0.5) },
      { label: `${Math.round(max * 0.75)}`, color: interpolatePalette(LOC_HEATMAP, 0.75) },
      { label: `${max}+`, color: interpolatePalette(LOC_HEATMAP, 1) },
    ]
  }
  if (mode === 'hotness') {
    const max = Math.max(ctx.maxHotness, 1)
    return [
      { label: '0', color: interpolatePalette(HOTNESS_HEATMAP, 0) },
      { label: `${Math.round(max * 0.25)}`, color: interpolatePalette(HOTNESS_HEATMAP, 0.25) },
      { label: `${Math.round(max * 0.5)}`, color: interpolatePalette(HOTNESS_HEATMAP, 0.5) },
      { label: `${Math.round(max * 0.75)}`, color: interpolatePalette(HOTNESS_HEATMAP, 0.75) },
      { label: `${max}`, color: interpolatePalette(HOTNESS_HEATMAP, 1) },
    ]
  }
  return null
}

export interface BuildingT {
  file: File
  x: number
  z: number
  w: number
  d: number
  h: number
  color: string
}

export interface DistrictT {
  folder: string
  x: number
  z: number
  w: number
  d: number
  fileCount: number
  totalLoc: number
}

export interface CityEdgeT {
  id: number
  source_id: number
  target_id: number
}

export interface CityTotalsT {
  totalLoc: number
  tallest: BuildingT | null
  largestDistrict: DistrictT | null
  hub: { file: File; connections: number } | null
}

export interface CityLayoutT {
  districts: DistrictT[]
  buildings: BuildingT[]
  buildingByFileId: Map<number, BuildingT>
  edges: CityEdgeT[]
  incoming: Map<number, number[]>
  outgoing: Map<number, number[]>
  totals: CityTotalsT
  size: { w: number; d: number }
  maxLoc: number
  maxHotness: number
  historyByFile: Map<number, FileHistory>
}

// Wider footprints, lower skyline — buildings should read as proper squat
// blocks rather than thin spikes. Height still scales with LOC so the ratio
// is preserved; only the magnitude shrinks.
const TILE = 7
const TILE_PAD = 2.2 // gap between buildings — visible breathing room
const FOLDER_PAD = 3
const FOLDER_LABEL_PAD = 5
const FOLDER_GAP = 8
const FOLDERS_PER_ROW_TARGET_RATIO = 1.4 // aspect ratio of overall city: w / d

const MIN_H = 0.8
const MAX_H = 24

export function buildCityLayout(graph: GraphResponse): CityLayoutT {
  const byFolder = new Map<string, File[]>()
  for (const f of graph.files) {
    const k = topLevelFolder(f.path)
    const arr = byFolder.get(k) ?? []
    arr.push(f)
    byFolder.set(k, arr)
  }

  // Sort folders by file count desc — biggest districts first.
  const folders = [...byFolder.entries()]
    .map(([folder, files]) => ({ folder, files: files.sort((a, b) => b.loc - a.loc) }))
    .sort((a, b) => b.files.length - a.files.length)

  // Compute each folder's inner grid (uniform TILE per file).
  const folderDims = folders.map(({ files }) => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(files.length * FOLDERS_PER_ROW_TARGET_RATIO)))
    const rows = Math.ceil(files.length / cols)
    const innerW = cols * TILE + (cols - 1) * TILE_PAD
    const innerD = rows * TILE + (rows - 1) * TILE_PAD
    return {
      cols,
      rows,
      w: innerW + FOLDER_PAD * 2,
      d: innerD + FOLDER_PAD * 2 + FOLDER_LABEL_PAD,
    }
  })

  // Pick folders-per-row to approximate target aspect ratio.
  const totalFolderArea = folderDims.reduce((s, d) => s + d.w * d.d, 0)
  const targetCityW = Math.sqrt(totalFolderArea * FOLDERS_PER_ROW_TARGET_RATIO)
  let perRow = 1
  for (let candidate = 1; candidate <= folders.length; candidate++) {
    let rowWidth = 0
    for (let i = 0; i < candidate; i++) rowWidth += (folderDims[i]?.w ?? 0) + FOLDER_GAP
    if (rowWidth > targetCityW) {
      perRow = Math.max(1, candidate)
      break
    }
    perRow = candidate
  }

  // Place folders in a row-major grid: each row's height = max d of folders in that row,
  // each row stacked vertically.
  const rowHeights: number[] = []
  const colWidths: number[] = Array(perRow).fill(0)
  folderDims.forEach((dim, i) => {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, dim.d)
    colWidths[col] = Math.max(colWidths[col] ?? 0, dim.w)
  })

  const colOffsets: number[] = [0]
  for (let i = 1; i < perRow; i++) {
    colOffsets[i] = (colOffsets[i - 1] ?? 0) + (colWidths[i - 1] ?? 0) + FOLDER_GAP
  }
  const rowOffsets: number[] = [0]
  for (let i = 1; i < rowHeights.length; i++) {
    rowOffsets[i] = (rowOffsets[i - 1] ?? 0) + (rowHeights[i - 1] ?? 0) + FOLDER_GAP
  }

  const districts: DistrictT[] = []
  const buildings: BuildingT[] = []
  const maxLoc = Math.max(1, ...graph.files.map((f) => f.loc))

  folders.forEach(({ folder, files }, i) => {
    const dim = folderDims[i]
    if (!dim) return
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const x = colOffsets[col] ?? 0
    const z = rowOffsets[row] ?? 0
    const totalLoc = files.reduce((s, f) => s + Math.max(f.loc, 1), 0)

    districts.push({
      folder,
      x,
      z,
      w: dim.w,
      d: dim.d,
      fileCount: files.length,
      totalLoc,
    })

    files.forEach((file, idx) => {
      const c = idx % dim.cols
      const r = Math.floor(idx / dim.cols)
      const bx = x + FOLDER_PAD + c * (TILE + TILE_PAD)
      const bz = z + FOLDER_PAD + FOLDER_LABEL_PAD + r * (TILE + TILE_PAD)
      const t = Math.log(file.loc + 1) / Math.log(maxLoc + 1)
      buildings.push({
        file,
        x: bx,
        z: bz,
        w: TILE,
        d: TILE,
        h: MIN_H + t * (MAX_H - MIN_H),
        color: cityColor(file.language),
      })
    })
  })

  const buildingByFileId = new Map<number, BuildingT>()
  for (const b of buildings) buildingByFileId.set(b.file.id, b)

  const edges: CityEdgeT[] = []
  const incoming = new Map<number, number[]>()
  const outgoing = new Map<number, number[]>()
  for (const e of graph.edges) {
    if (e.edge_kind !== 'import' || e.source_kind !== 'file' || e.target_kind !== 'file') continue
    if (!buildingByFileId.has(e.source_id) || !buildingByFileId.has(e.target_id)) continue
    edges.push({ id: e.id, source_id: e.source_id, target_id: e.target_id })
    const out = outgoing.get(e.source_id) ?? []
    out.push(e.target_id)
    outgoing.set(e.source_id, out)
    const inc = incoming.get(e.target_id) ?? []
    inc.push(e.source_id)
    incoming.set(e.target_id, inc)
  }

  let totalLoc = 0
  for (const f of graph.files) totalLoc += f.loc

  let tallest: BuildingT | null = null
  for (const b of buildings) if (!tallest || b.h > tallest.h) tallest = b

  let largestDistrict: DistrictT | null = null
  for (const d of districts) if (!largestDistrict || d.fileCount > largestDistrict.fileCount) largestDistrict = d

  let hub: { file: File; connections: number } | null = null
  for (const b of buildings) {
    const c = (incoming.get(b.file.id)?.length ?? 0) + (outgoing.get(b.file.id)?.length ?? 0)
    if (!hub || c > hub.connections) hub = { file: b.file, connections: c }
  }

  // Total city footprint:
  const totalW = colOffsets.reduce((s, off, i) => Math.max(s, off + (colWidths[i] ?? 0)), 0)
  const totalD = rowOffsets.reduce((s, off, i) => Math.max(s, off + (rowHeights[i] ?? 0)), 0)

  const historyByFile = new Map<number, FileHistory>(graph.history.map((h) => [h.file_id, h]))
  let maxHotness = 0
  for (const h of graph.history) if (h.commits_30d > maxHotness) maxHotness = h.commits_30d

  return {
    districts,
    buildings,
    buildingByFileId,
    edges,
    incoming,
    outgoing,
    totals: { totalLoc, tallest, largestDistrict, hub },
    size: { w: Math.max(totalW, 1), d: Math.max(totalD, 1) },
    maxLoc,
    maxHotness,
    historyByFile,
  }
}
