// Client for the local filesystem browser (GET /api/fs/browse). Used by the
// folder picker in the indexing dialog so users can navigate the disk and
// pick a repo to index instead of typing an absolute path.

export interface FsDirEntry {
  name: string
  path: string
  isGitRepo: boolean
  isHidden: boolean
}

export interface FsBrowseResult {
  path: string
  parent: string | null
  home: string
  separator: string
  entries: FsDirEntry[]
}

export async function browseDirectory(
  dirPath?: string,
  opts: { signal?: AbortSignal } = {},
): Promise<FsBrowseResult> {
  const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''
  const res = await fetch(`/api/fs/browse${qs}`, { signal: opts.signal })
  if (!res.ok) {
    let message = `Failed to read directory (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(message)
  }
  return (await res.json()) as FsBrowseResult
}
