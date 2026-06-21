// Deterministic filesystem walk. Produces the set of scannable source files
// under a repo root, honoring a built-in exclude list plus the repo's root
// .gitignore. No network, read-only. The walk + sort order is stable so file
// ids (assigned downstream) never churn between runs.
//
// IMPORTANT — exclude scoping. A grammar's ignore patterns (e.g. C#'s NuGet
// `packages/`, Go's `vendor/`, Rust's `target/`) are applied ONLY when that
// language is actually present in the repo. Flattening every grammar's ignores
// onto every repo silently deletes real source — e.g. a JS/TS monorepo's
// `packages/` directory (and everything under it) got dropped because C# ignores
// a dir of the same name. So we walk first, learn which grammars are here, then
// apply just those grammars' ignores. Only a small set of universally-safe,
// never-source dep/cache dirs (node_modules, venv, dotted tool caches) are
// pruned during the walk itself, for speed on large repos.

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Language } from './types.js'
import type { GrammarId } from './parse/treesitter.js'
import { EXT_TO_GRAMMAR, GRAMMAR_EXCLUDES, UNIVERSAL_EXCLUDES, grammarIdFromPath } from './parse/extensions.js'
import { parseJsonc } from './jsonc.js'

export interface ScannedFile {
  absPath: string
  /** Repo-relative POSIX path. */
  relPath: string
  language: Language
  content: string
  loc: number
  sha: string
  lastModified: number
}

// Map of file extension (no dot) → language. Derived from the shared
// EXT_TO_GRAMMAR map in parse/extensions.ts (the parseable grammars).
// Grammar ids that don't equal their Language. Everything else is identity
// (e.g. 'php' grammar → 'php' language); these two differ.
const GRAMMAR_TO_LANGUAGE: Record<string, Language> = {
  c_sharp: 'csharp',
  tsx: 'typescript', // .tsx is still TypeScript, not its own language
}
function grammarIdToLanguage(g: string): Language {
  return GRAMMAR_TO_LANGUAGE[g] ?? (g as Language)
}
const EXT_LANGUAGE: Record<string, Language> = {}
for (const [ext, gid] of Object.entries(EXT_TO_GRAMMAR)) {
  EXT_LANGUAGE[ext] = grammarIdToLanguage(gid)
}

// Languages with no tree-sitter grammar that we still want as graph nodes:
// template files (load-bearing in PHP views) and markdown docs (READMEs the
// narrator reads). They get a language label but no parsed symbols.
const FILE_ONLY_LANGUAGE: Record<string, Language> = {
  twig: 'twig',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  // Electronic design / hardware. KiCad, EAGLE, Gerber, drill, plot — text
  // files with no grammar, labeled 'eda' so hardware repos read as their own
  // category. NB: a few of these extensions are ambiguous (.pro is also Qt/IDL,
  // .sch/.net are generic) — in a hardware context EDA is the useful default.
  kicad_pcb: 'eda',
  kicad_sch: 'eda',
  kicad_pro: 'eda',
  kicad_mod: 'eda',
  kicad_sym: 'eda',
  kicad_wks: 'eda',
  kicad_dru: 'eda',
  sch: 'eda',
  brd: 'eda',
  lbr: 'eda',
  dcm: 'eda',
  net: 'eda',
  pro: 'eda',
  plt: 'eda',
  drl: 'eda',
  xln: 'eda',
  // Common Gerber layer extensions.
  gbr: 'eda',
  gbl: 'eda',
  gtl: 'eda',
  gbs: 'eda',
  gts: 'eda',
  gbo: 'eda',
  gto: 'eda',
  gko: 'eda',
  gm1: 'eda',
  gml: 'eda',
}

// Well-known extensionless / dotless filenames that ARE parseable by a grammar
// we have. Everything else without an extension is still kept as 'other' (see
// detectLanguage) — this map only upgrades the ones we can actually parse.
const FILENAME_LANGUAGE: Record<string, Language> = {
  gemfile: 'ruby',
  rakefile: 'ruby',
  guardfile: 'ruby',
  capfile: 'ruby',
  brewfile: 'ruby',
  vagrantfile: 'ruby',
  podfile: 'ruby',
  fastfile: 'ruby',
  appfile: 'ruby',
  matchfile: 'ruby',
  dangerfile: 'ruby',
  berksfile: 'ruby',
  thorfile: 'ruby',
}

// Known-binary extensions: never graph nodes. Everything else that reads as
// text is included (as 'other' if unrecognised) so the WHOLE codebase shows up,
// not just the languages we can parse.
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'svg', 'avif', 'heic',
  'pdf', 'mp4', 'mov', 'avi', 'webm', 'mkv', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'rar', '7z',
  'jar', 'war', 'ear', 'class', 'so', 'dylib', 'dll', 'exe', 'bin', 'dat', 'wasm',
  'node', 'pyc', 'pyo', 'o', 'a', 'lib', 'obj', 'parquet', 'avro', 'orc',
  'db', 'sqlite', 'sqlite3', 'mdb', 'lock', 'psd', 'ai', 'sketch',
])

interface Matcher {
  test: (relPath: string, isDir: boolean) => boolean
  negate: boolean
}

// Convert a single .gitignore-style pattern into a matcher over repo-relative
// POSIX paths. Supports: comments, blank lines, trailing-slash dir patterns,
// leading-slash anchoring, `*`/`**`/`?` wildcards, and `!` negation. This is a
// pragmatic subset — full gitignore semantics (nested ignore files) are out of
// scope, but the common cases that bloat a graph are covered.
function compilePattern(raw: string): Matcher | null {
  let pattern = raw.trim()
  if (pattern.length === 0 || pattern.startsWith('#')) return null

  const negate = pattern.startsWith('!')
  if (negate) pattern = pattern.slice(1)

  const dirOnly = pattern.endsWith('/')
  if (dirOnly) pattern = pattern.slice(0, -1)

  const anchored = pattern.startsWith('/')
  if (anchored) pattern = pattern.slice(1)

  // Escape regex metacharacters, then re-enable glob wildcards.
  let body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ') // placeholder for "any depth"
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*')
    .replace(/\?/g, '[^/]')

  // Anchored patterns match from the repo root; unanchored match any segment.
  const prefix = anchored ? '^' : '(^|/)'
  const suffix = dirOnly ? '(/|$)' : '(/|$)'
  const regex = new RegExp(`${prefix}${body}${suffix}`)

  return {
    negate,
    test: (relPath: string, _isDir: boolean) => regex.test(relPath),
  }
}

function compileAll(patterns: Iterable<string>): Matcher[] {
  const matchers: Matcher[] = []
  for (const p of patterns) {
    const m = compilePattern(p)
    if (m) matchers.push(m)
  }
  return matchers
}

// Base matchers applied DURING the walk: universally-safe dep/cache dirs, the
// repo's root .gitignore, and any project-declared excludes (e.g. tsconfig
// `exclude`). Deliberately does NOT include grammar-specific ignores — those
// are scoped to present languages and applied after the walk.
function loadBaseMatchers(rootPath: string, extraExcludes: string[]): Matcher[] {
  const matchers = compileAll(UNIVERSAL_EXCLUDES)
  const gitignorePath = path.join(rootPath, '.gitignore')
  try {
    const text = fs.readFileSync(gitignorePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = compilePattern(line)
      if (m) matchers.push(m)
    }
  } catch {
    // No .gitignore — defaults are enough.
  }
  matchers.push(...compileAll(extraExcludes))
  return matchers
}

// Ignore patterns for the grammars actually present in the repo (and only
// those). A C# repo gets C#'s `packages/`; a pure JS repo never does.
function grammarExcludeMatchers(present: Set<GrammarId>): Matcher[] {
  const patterns: string[] = []
  for (const g of present) {
    const pats = GRAMMAR_EXCLUDES[g]
    if (pats) patterns.push(...pats)
  }
  return compileAll(patterns)
}

// Re-scope a directory-local ignore matcher so it only fires on paths INSIDE
// that directory's subtree. A nested .gitignore / tsconfig `exclude` is written
// relative to the file that declares it, not the repo root — so we strip the
// declaring directory's prefix before testing the (root-relative) pattern.
function scopeMatcher(base: Matcher, relDir: string): Matcher {
  if (relDir === '') return base
  const prefix = relDir + '/'
  return {
    negate: base.negate,
    test: (relPath, isDir) => relPath.startsWith(prefix) && base.test(relPath.slice(prefix.length), isDir),
  }
}

// Read a directory's own tsconfig.json / jsconfig.json `exclude` list (the same
// patterns the project already hides from its TS toolchain). Anchored to the
// config's directory — tsconfig excludes are relative paths, not "any segment".
function dirConfigExcludes(absDir: string): string[] {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let raw: string
    try {
      raw = fs.readFileSync(path.join(absDir, name), 'utf8')
    } catch {
      continue
    }
    let cfg: unknown
    try {
      cfg = parseJsonc(raw)
    } catch {
      return []
    }
    const ex = (cfg as { exclude?: unknown })?.exclude
    if (!Array.isArray(ex)) return []
    return ex
      .filter((e: unknown): e is string => typeof e === 'string')
      .map((p) => (p.startsWith('/') ? p : '/' + p))
  }
  return []
}

// Matchers contributed by a directory's OWN config: its nested .gitignore and
// its tsconfig/jsconfig `exclude`, each scoped to this subtree. The root dir is
// skipped (relDir === '') — its .gitignore is already in the base matchers and
// its tsconfig excludes arrive via build-time extraExcludes. This is what lets a
// monorepo's per-package ignores (e.g. backend/mastra/.gitignore hiding build
// output, frontend/tsconfig.json excluding docs/archive) keep that noise out of
// the graph instead of ranking minified bundles as "most relevant".
function nestedIgnoreMatchers(absDir: string, relDir: string): Matcher[] {
  if (relDir === '') return []
  const out: Matcher[] = []
  try {
    const text = fs.readFileSync(path.join(absDir, '.gitignore'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = compilePattern(line)
      if (m) out.push(scopeMatcher(m, relDir))
    }
  } catch {
    // no nested .gitignore here
  }
  for (const p of dirConfigExcludes(absDir)) {
    const m = compilePattern(p)
    if (m) out.push(scopeMatcher(m, relDir))
  }
  return out
}

// A path is excluded if any non-negated matcher matches and no later negation
// re-includes it (gitignore "last match wins" for negation).
function isExcluded(relPath: string, isDir: boolean, matchers: Matcher[]): boolean {
  let excluded = false
  for (const m of matchers) {
    if (m.test(relPath, isDir)) excluded = !m.negate
  }
  return excluded
}

// Language for a path: a parseable grammar, a file-only language (template/doc),
// or 'other' for any unknown TEXT file — including extensionless files
// (Dockerfile, Makefile, LICENSE) and dotfiles (.env.example) — so the whole
// codebase is in the graph. Returns null only for known-binary files.
function detectLanguage(relPath: string): Language | null {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1)
  const lower = base.toLowerCase()
  // Laravel Blade's compound extension: "x.blade.php" → blade, not php.
  if (lower.endsWith('.blade.php')) return 'blade'
  const dot = base.lastIndexOf('.')
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase()
    if (BINARY_EXTS.has(ext)) return null
    return EXT_LANGUAGE[ext] ?? FILE_ONLY_LANGUAGE[ext] ?? 'other'
  }
  // Extensionless (Makefile, Dockerfile, LICENSE) or dotfile (.env, .gitignore):
  // upgrade the parseable ones, keep the rest as 'other' so nothing is omitted.
  // Binary content is still filtered later by the NUL-byte check.
  return FILENAME_LANGUAGE[lower] ?? 'other'
}

// A NUL byte in the first chunk means the file is binary, not text.
function looksBinary(content: string): boolean {
  const n = Math.min(content.length, 8000)
  for (let i = 0; i < n; i++) if (content.charCodeAt(i) === 0) return true
  return false
}

const NEWLINE = 10
const CARRIAGE_RETURN = 13

function hashAndCountLoc(content: string): { sha: string; loc: number } {
  const hasher = createHash('sha1')
  let loc = 0
  let lastNonEmpty = false
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i)
    if (c === NEWLINE) {
      if (lastNonEmpty) loc++
      lastNonEmpty = false
    } else if (c !== CARRIAGE_RETURN) {
      lastNonEmpty = true
    }
    hasher.update(Buffer.from([c]))
  }
  if (lastNonEmpty) loc++
  return { sha: hasher.digest('hex').slice(0, 12), loc }
}

export interface ScanOptions {
  /** Max bytes to read per file; larger files are skipped (default 1.5 MB). */
  maxFileBytes?: number
  /**
   * Extra gitignore-style exclude patterns appended to the defaults + .gitignore
   * (e.g. tsconfig `exclude` entries like "docs/archive"). Keeps legacy/vendored
   * code the project itself excludes out of the graph.
   */
  extraExcludes?: string[]
}

interface Candidate {
  absPath: string
  relPath: string
  language: Language
}

/**
 * Walk `rootPath` and return all scannable source files, sorted by relative
 * path for deterministic downstream id assignment.
 */
export function scanRepo(rootPath: string, opts: ScanOptions = {}): ScannedFile[] {
  console.error(`[scan] scanning ${rootPath}`)
  const absRoot = path.resolve(rootPath)
  const maxBytes = opts.maxFileBytes ?? 1_500_000
  const baseMatchers = loadBaseMatchers(absRoot, opts.extraExcludes ?? [])

  // ── Pass 1: walk, pruning only the universally-safe dep/cache dirs + the
  // repo's own ignores. Collect candidate files and the grammars present. No
  // file content is read here, so descending a build dir costs just a readdir.
  const candidates: Candidate[] = []
  const present = new Set<GrammarId>()
  let scannedDirs = 0

  const walk = (dir: string, relDir: string, inherited: Matcher[]) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable dir — skip
    }
    // Layer this directory's own nested ignores over the inherited ones, so a
    // subtree's .gitignore / tsconfig excludes apply to everything below it.
    const nested = nestedIgnoreMatchers(dir, relDir)
    const matchers = nested.length > 0 ? [...inherited, ...nested] : inherited
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(absRoot, abs).split(path.sep).join('/')
      const isDir = entry.isDirectory()
      if (isExcluded(rel, isDir, matchers)) continue
      if (isDir) {
        scannedDirs++
        walk(abs, rel, matchers)
        continue
      }
      if (!entry.isFile()) continue
      const language = detectLanguage(rel)
      if (!language) continue
      const g = grammarIdFromPath(rel)
      if (g) present.add(g)
      candidates.push({ absPath: abs, relPath: rel, language })
    }
  }
  walk(absRoot, '', baseMatchers)

  // ── Pass 2: now that we know the languages here, apply each present grammar's
  // OWN ignores (build/cache dirs) — and nothing else's. Then read + hash the
  // survivors.
  const grammarMatchers = grammarExcludeMatchers(present)
  const out: ScannedFile[] = []
  let skippedBuildDir = 0
  let skippedSize = 0
  let skippedBinary = 0
  let skippedReadError = 0

  for (const c of candidates) {
    if (grammarMatchers.length > 0 && isExcluded(c.relPath, false, grammarMatchers)) {
      skippedBuildDir++
      continue
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(c.absPath)
    } catch {
      continue
    }
    if (stat.size > maxBytes) { skippedSize++; continue }
    let content: string
    try {
      content = fs.readFileSync(c.absPath, 'utf8')
    } catch {
      skippedReadError++
      continue
    }
    if (looksBinary(content)) { skippedBinary++; continue } // text-y name, binary content
    const { sha, loc } = hashAndCountLoc(content)
    out.push({
      absPath: c.absPath,
      relPath: c.relPath,
      language: c.language,
      content,
      loc,
      sha,
      lastModified: stat.mtimeMs,
    })
  }

  console.error(
    `[scan] done: ${out.length} files, ${scannedDirs} dirs` +
      ` | grammars: ${[...present].sort().join(', ') || 'none'}` +
      ` | skipped: ${skippedBuildDir} build-dir, ${skippedSize} too-large, ${skippedBinary} binary, ${skippedReadError} read-error`,
  )
  out.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return out
}
