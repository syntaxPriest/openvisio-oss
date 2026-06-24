// Browser GitHub fetcher. Turns a repo URL into an in-memory file set with NO
// clone and NO server: one CORS-friendly call to the GitHub trees API for the
// file list, then each file pulled from raw.githubusercontent (a CDN — CORS-ok
// and not subject to the API's 60/hr anon rate limit). Feeds indexFiles().
//
// Caps (reasoned from fetch time + browser memory): the bottleneck is the N raw
// requests, so we bound files/bytes to keep an index under ~2 min; bigger repos
// are told to use `openvisio transport` (the local CLI).

import { indexFiles, type InputFile } from './index'
import type { GraphResponse } from '@/lib/api/types'

export const CAP_FILES = 1500
export const CAP_TOTAL_BYTES = 20 * 1024 * 1024
export const CAP_FILE_BYTES = 1.5 * 1024 * 1024

const BINARY_EXT = new Set([
  'png','jpg','jpeg','gif','bmp','ico','webp','tiff','svg','avif','heic','pdf','mp4','mov','avi','webm','mkv',
  'mp3','wav','flac','ogg','m4a','woff','woff2','ttf','otf','eot','zip','tar','gz','tgz','bz2','xz','zst','rar','7z',
  'jar','war','class','so','dylib','dll','exe','bin','dat','wasm','node','pyc','parquet','db','sqlite','lock',
])
const EXCLUDE_DIR = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.turbo|coverage|vendor|target|__pycache__|\.venv|venv)(\/|$)/

export interface RepoRef { owner: string; repo: string; ref?: string }
export interface FetchProgress { phase: 'tree' | 'fetch' | 'index'; loaded?: number; total?: number }
export interface FetchOptions {
  token?: string
  onProgress?: (p: FetchProgress) => void
  signal?: AbortSignal
}

/** Parse the common GitHub URL/`owner/repo` forms → {owner, repo, ref?}. */
export function parseGithubUrl(input: string): RepoRef | null {
  let s = input.trim().replace(/\.git$/, '')
  const m = s.match(/github\.com[/:]([^/]+)\/([^/]+)(?:\/tree\/([^/]+(?:\/[^?#]*)?))?/i)
  if (m) return { owner: m[1], repo: m[2], ref: m[3] }
  const short = s.match(/^([\w.-]+)\/([\w.-]+)$/) // owner/repo
  if (short) return { owner: short[1], repo: short[2] }
  return null
}

const extOf = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase()

async function ghApi(path: string, opts: FetchOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  return fetch(`https://api.github.com${path}`, { headers, signal: opts.signal })
}

interface TreeEntry { path: string; type: string; size?: number }

/** Resolve files + contents for a repo. Throws a readable error on failure. */
export async function fetchRepoFiles(input: string, opts: FetchOptions = {}): Promise<{ files: InputFile[]; repoName: string; truncated: boolean; skipped: number }> {
  const ref0 = parseGithubUrl(input)
  if (!ref0) throw new Error('Not a GitHub repo URL (expected github.com/owner/repo or owner/repo)')
  opts.onProgress?.({ phase: 'tree' })

  // Default branch if none given.
  let resolvedRef = ref0.ref
  if (!resolvedRef) {
    const r = await ghApi(`/repos/${ref0.owner}/${ref0.repo}`, opts)
    if (r.status === 404) throw new Error('Repo not found (private repos need a token)')
    if (!r.ok) throw new Error(`GitHub API ${r.status}${r.status === 403 ? ' — rate limited; add a token' : ''}`)
    resolvedRef = ((await r.json()) as { default_branch?: string }).default_branch
  }
  const ref: string = resolvedRef || 'main'

  // One recursive tree call → the whole file list.
  const tr = await ghApi(`/repos/${ref0.owner}/${ref0.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, opts)
  if (!tr.ok) throw new Error(`Could not read repo tree (${tr.status}${tr.status === 403 ? ' — rate limited; add a token' : ''})`)
  const tree = await tr.json()
  const truncated = Boolean(tree.truncated)

  // Filter to text/source blobs under the caps.
  let total = 0, skipped = 0
  const picks: TreeEntry[] = []
  for (const e of (tree.tree ?? []) as TreeEntry[]) {
    if (e.type !== 'blob') continue
    if (EXCLUDE_DIR.test(e.path) || BINARY_EXT.has(extOf(e.path))) { skipped++; continue }
    if ((e.size ?? 0) > CAP_FILE_BYTES) { skipped++; continue }
    if (picks.length >= CAP_FILES || total + (e.size ?? 0) > CAP_TOTAL_BYTES) {
      throw new Error(`Repo too large for in-browser indexing (> ${CAP_FILES} files / ${CAP_TOTAL_BYTES / 1e6}MB). Use \`openvisio transport\` for this one.`)
    }
    picks.push(e); total += e.size ?? 0
  }

  // Pull each file from the raw CDN, concurrency-limited.
  const files: InputFile[] = new Array(picks.length)
  let done = 0
  opts.onProgress?.({ phase: 'fetch', loaded: 0, total: picks.length })
  const base = `https://raw.githubusercontent.com/${ref0.owner}/${ref0.repo}/${ref}/`
  const CONCURRENCY = 12
  let next = 0
  async function worker() {
    while (next < picks.length) {
      const i = next++
      const e = picks[i]
      try {
        const res = await fetch(base + e.path.split('/').map(encodeURIComponent).join('/'), { signal: opts.signal })
        files[i] = { path: e.path, content: res.ok ? await res.text() : '' }
      } catch {
        files[i] = { path: e.path, content: '' }
      }
      done++
      if (done % 8 === 0 || done === picks.length) opts.onProgress?.({ phase: 'fetch', loaded: done, total: picks.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, picks.length) }, worker))

  return { files, repoName: ref0.repo, truncated, skipped }
}

/** Fetch + index a GitHub repo entirely in the browser → GraphResponse. */
export async function indexGithubRepo(input: string, opts: FetchOptions = {}): Promise<GraphResponse> {
  const { files, repoName } = await fetchRepoFiles(input, opts)
  opts.onProgress?.({ phase: 'index' })
  return indexFiles(files, repoName)
}
