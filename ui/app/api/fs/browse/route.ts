// Filesystem directory browser. Powers the "Browse…" folder picker in the
// indexing dialog so users can navigate the local disk and select a repo to
// index instead of typing an absolute path by hand.
//
// This is a local-first tool: the server already reads local repos to index
// them, so exposing a read-only directory listing is consistent with that
// trust boundary. It lists subdirectories only (never file contents), flags
// which folders look like git repos, and resolves `~`/relative input against
// the user's home directory.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DirEntry {
  name: string
  path: string
  isGitRepo: boolean
  isHidden: boolean
}

interface BrowseResponse {
  path: string
  parent: string | null
  home: string
  separator: string
  entries: DirEntry[]
}

function resolveInput(raw: string | null): string {
  const home = os.homedir()
  if (!raw || raw.trim().length === 0) return home
  let p = raw.trim()
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(home, p.slice(2))
  // Resolve relative input against home rather than the server cwd, which is
  // an implementation detail the user can't see.
  if (!path.isAbsolute(p)) p = path.join(home, p)
  return path.resolve(p)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const target = resolveInput(url.searchParams.get('path'))

  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return Response.json({ error: `Cannot access: ${target}` }, { status: 404 })
  }
  if (!stat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${target}` }, { status: 400 })
  }

  let dirents
  try {
    dirents = await fs.readdir(target, { withFileTypes: true })
  } catch {
    return Response.json({ error: `Permission denied: ${target}` }, { status: 403 })
  }

  const entries: DirEntry[] = []
  for (const d of dirents) {
    // Symlinks report isDirectory() === false; resolve them so symlinked
    // repos still appear as navigable folders.
    let isDir = d.isDirectory()
    if (d.isSymbolicLink()) {
      try {
        isDir = (await fs.stat(path.join(target, d.name))).isDirectory()
      } catch {
        isDir = false
      }
    }
    if (!isDir) continue

    const full = path.join(target, d.name)
    let isGitRepo = false
    try {
      isGitRepo = (await fs.stat(path.join(full, '.git'))).isDirectory()
    } catch {
      // not a git repo (or .git is a file/worktree pointer we don't probe)
    }
    entries.push({
      name: d.name,
      path: full,
      isGitRepo,
      isHidden: d.name.startsWith('.'),
    })
  }

  // Git repos first, then alphabetical, case-insensitive.
  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  const parent = path.dirname(target)
  const body: BrowseResponse = {
    path: target,
    parent: parent === target ? null : parent,
    home: os.homedir(),
    separator: path.sep,
    entries,
  }
  return Response.json(body)
}
