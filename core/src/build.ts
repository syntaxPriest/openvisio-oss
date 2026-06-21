// Graph assembly. Takes scanned files, runs the tree-sitter parser over each,
// assigns stable numeric ids (in scan order — already sorted by relative path),
// resolves raw import specifiers to file-level directed edges, and returns the
// fully-derived CodeGraph. Deterministic and LLM-free: same repo bytes → same
// graph, same ids, same edge set, run after run.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { TextDecoder, TextEncoder } from 'node:util'
import { parseFile } from './parse/index.js'
import { scanRepo, type ScanOptions, type ScannedFile } from './scan.js'
import { parseJsonc } from './jsonc.js'
import { grammarForFile, loadGrammars } from './parse/treesitter.js'
import { GRAMMARS, type TsAliases } from './parse/grammars/index.js'
import type { Store } from './store.js'
import type {
  CodeEdge,
  CodeFile,
  CodeGraph,
  CodeSymbol,
  ParseResult,
  RawImport,
} from './types.js'

const posix = path.posix

// ---------------------------------------------------------------------------
// TS/JS path-alias resolution (tsconfig/jsconfig `baseUrl` + `paths`).
// These are needed during graph assembly to pass aliases to the TS/JS resolver.
// ---------------------------------------------------------------------------

interface AliasRule {
  prefix: string
  suffix: string
  targets: string[]
}

/**
 * Parse a tsconfig/jsconfig body into alias rules. `dirRel` is the config's own
 * directory, repo-relative ('' for the root) — it's prefixed onto `baseUrl` so
 * the rule targets (e.g. `src/*`) resolve repo-relative even for a config that
 * lives in a sub-package (e.g. `viewer/tsconfig.json` → baseUrl `viewer`). This
 * is what makes `@/…` imports resolve across a monorepo with no root tsconfig.
 */
function parseTsAliases(raw: string, dirRel: string): TsAliases | null {
  let config: any
  try {
    config = parseJsonc(raw)
  } catch {
    return null
  }
  const co = config?.compilerOptions ?? {}
  const baseUrlRaw: string = typeof co.baseUrl === 'string' ? co.baseUrl : '.'
  const baseRel = posix.normalize(baseUrlRaw).replace(/^\.\/?/, '').replace(/\/$/, '')
  let baseUrl = posix.join(dirRel || '.', baseRel === '.' ? '' : baseRel)
  if (baseUrl === '.') baseUrl = ''
  const rules: AliasRule[] = []
  const paths = co.paths
  if (paths && typeof paths === 'object') {
    for (const key of Object.keys(paths)) {
      const star = key.indexOf('*')
      const targets = (Array.isArray(paths[key]) ? paths[key] : []).filter(
        (t: unknown): t is string => typeof t === 'string',
      )
      if (targets.length === 0) continue
      if (star === -1) {
        rules.push({ prefix: key, suffix: '\0exact', targets })
      } else {
        rules.push({ prefix: key.slice(0, star), suffix: key.slice(star + 1), targets })
      }
    }
  }
  const excludes = (Array.isArray(config?.exclude) ? config.exclude : []).filter(
    (e: unknown): e is string => typeof e === 'string',
  )
  return { baseUrl, rules, excludes }
}

function loadTsAliases(absRoot: string): TsAliases {
  const empty: TsAliases = { baseUrl: '', rules: [], excludes: [] }
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let raw: string
    try {
      raw = fs.readFileSync(path.join(absRoot, name), 'utf8')
    } catch {
      continue
    }
    return parseTsAliases(raw, '') ?? empty
  }
  return empty
}

/** Dispatch resolution to the grammar file's own resolver. */
function resolveImport(
  file: CodeFile,
  spec: string,
  bySet: Set<string>,
  aliases: TsAliases,
): string | null {
  if (spec.length === 0) return null
  const gId = grammarForFile(file.path)
  if (!gId) return null
  const config = GRAMMARS[gId]
  if (!config?.resolveImport) return null
  return config.resolveImport(file.path, spec, bySet, aliases)
}

export interface BuildOptions extends ScanOptions {}

export async function buildGraph(rootPath: string, opts: BuildOptions = {}): Promise<CodeGraph> {
  const absRoot = path.resolve(rootPath)
  const aliases = loadTsAliases(absRoot)
  const scanned = scanRepo(rootPath, {
    ...opts,
    extraExcludes: [...(opts.extraExcludes ?? []), ...aliases.excludes],
  })
  return assembleGraph(absRoot, scanned, { aliases })
}

/** In-memory parse result cache keyed by content SHA. */
export type ParseCache = Map<string, ParseResult>

export interface AssembleContext {
  cache?: ParseCache | Store
  idByPath?: Map<string, number>
  aliases?: TsAliases
}

export async function assembleGraph(
  absRoot: string,
  scanned: ScannedFile[],
  ctx: AssembleContext = {},
): Promise<CodeGraph> {
  const cache = ctx.cache
  const idByPath = ctx.idByPath ?? new Map<string, number>()
  let nextFileId = 0
  for (const id of idByPath.values()) nextFileId = Math.max(nextFileId, id + 1)
  const allocId = (relPath: string): number => {
    let id = idByPath.get(relPath)
    if (id === undefined) {
      id = nextFileId++
      idByPath.set(relPath, id)
    }
    return id
  }

  const files: CodeFile[] = []
  const symbols: CodeSymbol[] = []
  const symbolsByFile = new Map<number, CodeSymbol[]>()
  const fileIdByPath = new Map<string, number>()
  const filesById = new Map<number, CodeFile>()
  const rawImportsByFile = new Map<number, RawImport[]>()
  const rawCallsByFile = new Map<number, ParseResult['calls']>()

  let nextSymbolId = 0
  console.error(`[build] phase 1: assigning IDs to ${scanned.length} files`)
  for (const sf of scanned) {
    const fileId = allocId(sf.relPath)
    files.push({
      id: fileId,
      path: sf.relPath,
      language: sf.language,
      loc: sf.loc,
      sha: sf.sha,
      lastModified: sf.lastModified,
    })
    filesById.set(fileId, files[files.length - 1]!)
    fileIdByPath.set(sf.relPath, fileId)
  }

  console.error(`[build] phase 1 done: ${files.length} files`)

  // Phase 1.5: pre-load the tree-sitter grammars this repo needs (sequential —
  // Language.load is not re-entrant). After this, batch parsing is safe.
  const neededGrammars = new Set<import('./parse/treesitter.js').GrammarId>()
  for (const sf of scanned) {
    const g = grammarForFile(sf.relPath)
    if (g) neededGrammars.add(g)
  }
  console.error(`[build] phase 1.5: loading ${neededGrammars.size} grammars: ${[...neededGrammars].join(', ')}`)
  if (neededGrammars.size > 0) await loadGrammars([...neededGrammars])
  console.error(`[build] phase 1.5 done`)

  // Helper: parse a single file, hitting cache when possible.
  const parseOne = async (sf: ScannedFile): Promise<ParseResult> => {
    if (cache && 'get' in cache && 'set' in cache) {
      const store = cache as Store
      const key = `parse:${sf.sha}`
      const raw = store.get(key)
      if (raw) return JSON.parse(new TextDecoder().decode(raw)) as ParseResult
    } else {
      const pc = cache as ParseCache | undefined
      const cached = pc?.get(sf.sha)
      if (cached) return cached
    }
    let parsed: ParseResult
    try {
      parsed = await parseFile(sf.relPath, sf.content)
    } catch (err) {
      console.error(`[build] parse error for ${sf.relPath}: ${err}`)
      parsed = { symbols: [], imports: [], calls: [] }
    }
    if (cache && 'get' in cache && 'set' in cache) {
      const store = cache as Store
      store.set(`parse:${sf.sha}`, new TextEncoder().encode(JSON.stringify(parsed)))
    } else {
      const pc = cache as ParseCache | undefined
      if (pc) pc.set(sf.sha, parsed)
    }
    return parsed
  }

  // Phase 2: parse files in concurrent batches of 500.
  const BATCH = 500
  const totalBatches = Math.ceil(scanned.length / BATCH)
  console.error(`[build] phase 2: parsing ${scanned.length} files in ${totalBatches} batches of ${BATCH}`)
  for (let i = 0; i < scanned.length; i += BATCH) {
    const batch = scanned.slice(i, i + BATCH)
    const batchNum = i / BATCH + 1
    console.error(`[build] batch ${batchNum}/${totalBatches} (${batch.length} files)`)
    const results = await Promise.all(batch.map((sf) => parseOne(sf)))
    for (let j = 0; j < batch.length; j++) {
      const sf = batch[j]!
      const parsed = results[j]!
      const fileId = fileIdByPath.get(sf.relPath)!
      const fileSymbols: CodeSymbol[] = []
      for (const s of parsed.symbols) {
        const sym: CodeSymbol = { id: nextSymbolId++, fileId, ...s }
        symbols.push(sym)
        fileSymbols.push(sym)
      }
      symbolsByFile.set(fileId, fileSymbols)
      rawImportsByFile.set(fileId, parsed.imports)
      rawCallsByFile.set(fileId, parsed.calls ?? [])
    }
  }
  console.error(`[build] phase 2 done: ${symbols.length} symbols extracted`)

  console.error(`[build] resolving imports across ${files.length} files...`)
  const bySet = new Set(fileIdByPath.keys())

  // Per-package alias resolution. A monorepo can have many tsconfig/jsconfig
  // files (one per sub-package, often with no root config at all), each mapping
  // `@/*` to its own `src/*`. Discover them all from the scanned set and resolve
  // every file's imports against its NEAREST enclosing config — otherwise all
  // `@/…` imports go unresolved and the import graph collapses to relative-only.
  const aliasEntries: { dir: string; aliases: TsAliases }[] = []
  for (const sf of scanned) {
    const base = posix.basename(sf.relPath)
    if (base !== 'tsconfig.json' && base !== 'jsconfig.json') continue
    const dirRaw = posix.dirname(sf.relPath)
    const dir = dirRaw === '.' ? '' : dirRaw
    const parsed = parseTsAliases(sf.content, dir)
    if (parsed) aliasEntries.push({ dir, aliases: parsed })
  }
  // Longest dir first so the nearest config wins the prefix match.
  aliasEntries.sort((a, b) => b.dir.length - a.dir.length)
  const rootAliases = ctx.aliases ?? loadTsAliases(absRoot)
  const aliasesFor = (relPath: string): TsAliases => {
    for (const e of aliasEntries) {
      if (e.dir === '' || relPath === e.dir || relPath.startsWith(e.dir + '/')) return e.aliases
    }
    return rootAliases
  }

  const edgeWeights = new Map<string, number>()
  for (const file of files) {
    const raws = rawImportsByFile.get(file.id) ?? []
    const aliases = aliasesFor(file.path)
    for (const raw of raws) {
      const targetPath = resolveImport(file, raw.specifier, bySet, aliases)
      if (targetPath == null) continue
      const targetId = fileIdByPath.get(targetPath)
      if (targetId == null || targetId === file.id) continue
      const key = `${file.id}->${targetId}`
      edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1)
    }
  }

  const edgeEntries = [...edgeWeights.entries()].map(([key, weight]) => {
    const [sourceId, targetId] = key.split('->').map(Number) as [number, number]
    return { sourceId, targetId, weight }
  })
  edgeEntries.sort((a, b) => {
    const sa = filesById.get(a.sourceId)!.path
    const sb = filesById.get(b.sourceId)!.path
    if (sa !== sb) return sa.localeCompare(sb)
    const ta = filesById.get(a.targetId)!.path
    const tb = filesById.get(b.targetId)!.path
    return ta.localeCompare(tb)
  })
  const edges: CodeEdge[] = edgeEntries.map((e, i) => ({
    id: i,
    sourceId: e.sourceId,
    targetId: e.targetId,
    kind: 'import',
    weight: e.weight,
  }))
  console.error(`[build] import resolution done: ${edges.length} edges`)

  // ---- Heuristic call edges (function → function) ----------------------------
  const nameIndex = new Map<string, CodeSymbol[]>()
  for (const s of symbols) {
    const list = nameIndex.get(s.name)
    if (list) list.push(s)
    else nameIndex.set(s.name, [s])
  }
  const importTargets = new Map<number, Set<number>>()
  for (const e of edges) {
    let set = importTargets.get(e.sourceId)
    if (!set) {
      set = new Set<number>()
      importTargets.set(e.sourceId, set)
    }
    set.add(e.targetId)
  }
  const enclosing = (fileSymbols: CodeSymbol[], line: number): CodeSymbol | null => {
    let best: CodeSymbol | null = null
    for (const s of fileSymbols) {
      if (s.startLine <= line && line <= s.endLine) {
        if (!best || s.endLine - s.startLine < best.endLine - best.startLine) best = s
      }
    }
    return best
  }
  const resolveCallee = (name: string, fromFileId: number): CodeSymbol | null => {
    const cands = nameIndex.get(name)
    if (!cands || cands.length === 0) return null
    const sameFile = cands.find((c) => c.fileId === fromFileId)
    if (sameFile) return sameFile
    const targets = importTargets.get(fromFileId)
    if (targets) {
      const imported = cands.filter((c) => targets.has(c.fileId))
      if (imported.length > 0) {
        imported.sort((a, b) => Number(b.exported) - Number(a.exported) || a.id - b.id)
        return imported[0]!
      }
    }
    return null
  }

  console.error(`[build] building call edges over ${symbols.length} symbols...`)
  const callWeights = new Map<string, number>()
  for (const file of files) {
    const calls = rawCallsByFile.get(file.id) ?? []
    if (calls.length === 0) continue
    const fileSymbols = symbolsByFile.get(file.id) ?? []
    for (const call of calls) {
      const caller = enclosing(fileSymbols, call.line)
      if (!caller) continue
      const callee = resolveCallee(call.callee, file.id)
      if (!callee || callee.id === caller.id) continue
      const key = `${caller.id}->${callee.id}`
      callWeights.set(key, (callWeights.get(key) ?? 0) + 1)
    }
  }
  const callEntries = [...callWeights.entries()]
    .map(([key, weight]) => {
      const [sourceId, targetId] = key.split('->').map(Number) as [number, number]
      return { sourceId, targetId, weight }
    })
    .sort((a, b) => a.sourceId - b.sourceId || a.targetId - b.targetId)
  let nextEdgeId = edges.length
  for (const c of callEntries) {
    edges.push({ id: nextEdgeId++, sourceId: c.sourceId, targetId: c.targetId, kind: 'calls', weight: c.weight })
  }
  console.error(`[build] call edges done: ${callEntries.length} call edges, ${edges.length} total edges`)

  // Build adjacency index for O(1) import-edge neighbor lookups.
  const adjacency = new Map<number, { in: CodeEdge[]; out: CodeEdge[] }>()
  for (const f of files) adjacency.set(f.id, { in: [], out: [] })
  for (const e of edges) {
    if (e.kind !== 'import') continue
    adjacency.get(e.sourceId)!.out.push(e)
    adjacency.get(e.targetId)!.in.push(e)
  }

  console.error(`[build] done: ${files.length} files, ${symbols.length} symbols, ${edges.length} edges`)
  return {
    rootPath: absRoot,
    name: path.basename(absRoot),
    files,
    symbols,
    edges,
    adjacency,
    filesById,
    fileIdByPath,
    symbolsByFile,
  }
}

export interface IndexChanges {
  added: string[]
  removed: string[]
  changed: string[]
}

// Persistent-cache schema version. The LMDB cache stores parse results (keyed by
// content SHA) and file IDs (keyed by path). Those are only valid for the engine
// that wrote them — when the parser's output shape changes (new symbol fields,
// import/call extraction, id allocation), a same-SHA entry from an OLDER engine
// would be served verbatim, silently dropping imports/edges or aliasing symbols
// to the wrong file. BUMP THIS whenever parse output or id allocation changes;
// the Indexer wipes a cache whose stored version doesn't match.
export const CACHE_VERSION = 2
const CACHE_VERSION_KEY = 'meta:cacheVersion'

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function encodeU32(n: number): Uint8Array {
  const buf = new Uint8Array(4)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, n, true)
  return buf
}

function decodeU32(buf: Uint8Array): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true)
}

export class Indexer {
  private readonly cache: ParseCache = new Map()
  private readonly idByPath = new Map<string, number>()
  private shaByPath = new Map<string, string>()
  private aliasesCache: TsAliases | null = null
  readonly absRoot: string
  private readonly dbPath?: string
  private store?: Store

  constructor(
    private readonly rootPath: string,
    private readonly opts: BuildOptions = {},
    dbPath?: string,
  ) {
    this.absRoot = path.resolve(rootPath)
    this.dbPath = dbPath
  }

  async build(): Promise<CodeGraph> {
    if (this.dbPath && !this.store) {
      const { LmdbStore } = await import('./stores/lmdb.js')
      this.store = new LmdbStore(this.dbPath)
      this.ensureCacheVersion(this.store)
    }
    return (await this.run()).graph
  }

  /**
   * Wipe the cache if it was written by a different engine version. A same-SHA
   * parse result (or persisted file id) from an older engine is NOT safe to
   * reuse — it can drop import/call edges or alias symbols to the wrong file —
   * so on a version mismatch we clear everything and start the cache fresh.
   */
  private ensureCacheVersion(store: Store): void {
    const want = new TextEncoder().encode(String(CACHE_VERSION))
    const have = store.get(CACHE_VERSION_KEY)
    if (!have || !bytesEqual(have, want)) {
      store.clear()
      store.set(CACHE_VERSION_KEY, want)
      store.sync()
    }
  }

  async reindex(): Promise<{ graph: CodeGraph; changes: IndexChanges }> {
    return this.run()
  }

  close(): void {
    this.store?.close()
    this.store = undefined
  }

  private async run(): Promise<{ graph: CodeGraph; changes: IndexChanges }> {
    if (!this.aliasesCache) this.aliasesCache = loadTsAliases(this.absRoot)
    const scanned = scanRepo(this.rootPath, {
      ...this.opts,
      extraExcludes: [...(this.opts.extraExcludes ?? []), ...this.aliasesCache.excludes],
    })

    // Restore persistent file IDs from store on first run.
    if (this.store && this.idByPath.size === 0) {
      for (const sf of scanned) {
        const idBuf = this.store.get(`id:${sf.relPath}`)
        // Only a well-formed 4-byte id is trustworthy; a truncated/corrupt
        // value from a legacy cache must never reach decodeU32 (it throws) or
        // seed a bogus id.
        if (idBuf && idBuf.length === 4) this.idByPath.set(sf.relPath, decodeU32(idBuf))
      }
      // Defensive: a corrupt/legacy store can hand back the SAME id for two
      // distinct paths, which would alias one file's symbols onto another file
      // (e.g. a function anchored to a tsconfig). If the restored ids aren't
      // unique, discard them all and reallocate fresh in scan order.
      const seen = new Set<number>()
      let collision = false
      for (const id of this.idByPath.values()) {
        if (seen.has(id)) {
          collision = true
          break
        }
        seen.add(id)
      }
      if (collision) this.idByPath.clear()
    }

    const changes: IndexChanges = { added: [], removed: [], changed: [] }
    const nextSha = new Map<string, string>()
    for (const sf of scanned) {
      nextSha.set(sf.relPath, sf.sha)
      const prev = this.shaByPath.get(sf.relPath)
      if (prev === undefined) changes.added.push(sf.relPath)
      else if (prev !== sf.sha) changes.changed.push(sf.relPath)
    }
    for (const p of this.shaByPath.keys()) if (!nextSha.has(p)) changes.removed.push(p)
    this.shaByPath = nextSha

    // Prune in-memory cache: remove entries whose SHA is no longer referenced
    // by any file (handles both removed and changed files).
    const liveShas = new Set(nextSha.values())
    for (const key of this.cache.keys()) {
      if (!liveShas.has(key)) this.cache.delete(key)
    }

    const graph = await assembleGraph(this.absRoot, scanned, {
      cache: this.store ?? this.cache,
      idByPath: this.idByPath,
      aliases: this.aliasesCache,
    })

    // Persist file IDs + SHA-512 change tracker to store.
    if (this.store) {
      for (const sf of scanned) {
        this.store.set(`id:${sf.relPath}`, encodeU32(graph.fileIdByPath.get(sf.relPath) ?? 0))
      }
      for (const p of changes.removed) {
        this.store.delete(`id:${p}`)
      }
      this.store.sync()
    }

    return { graph, changes }
  }
}
