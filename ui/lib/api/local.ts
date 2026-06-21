// Client for the local graph engine (GET /api/local-graph). Indexes a local
// repo with the deterministic OpenVisio engine — no LLM — and returns the
// viewer's GraphResponse + GroupGraphResponse, validated against our schemas.

import { GraphResponseSchema, GroupGraphResponseSchema, type GraphResponse, type GroupGraphResponse } from './types'

export interface LocalIndexResult {
  graph: GraphResponse
  groupGraph: GroupGraphResponse
}

// A source string is "remote" if it parses as a Git URL (https / ssh / git@),
// else it's treated as a local filesystem path.
export function isRemoteSource(source: string): boolean {
  return /^(https?:\/\/|git@[\w.-]+:|ssh:\/\/|git:\/\/)/i.test(source.trim()) || /\.git\/?$/i.test(source.trim())
}

async function fetchGraph(endpoint: string, signal?: AbortSignal): Promise<LocalIndexResult> {
  const res = await fetch(endpoint, { signal })
  if (!res.ok) {
    let message = `Indexing failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // non-JSON error body — keep the default
    }
    throw new Error(message)
  }
  const payload = (await res.json()) as { graph: unknown; groupGraph: unknown }
  return {
    graph: GraphResponseSchema.parse(payload.graph),
    groupGraph: GroupGraphResponseSchema.parse(payload.groupGraph),
  }
}

export async function getLocalGraph(
  repoPath: string,
  opts: { signal?: AbortSignal } = {},
): Promise<LocalIndexResult> {
  return fetchGraph(`/api/local-graph?path=${encodeURIComponent(repoPath)}`, opts.signal)
}

/** Clone (server-side) + index a remote Git repo. `ref` is an optional branch/tag. */
export async function getRemoteGraph(
  url: string,
  ref?: string,
  opts: { signal?: AbortSignal } = {},
): Promise<LocalIndexResult> {
  const q = new URLSearchParams({ url })
  if (ref) q.set('ref', ref)
  return fetchGraph(`/api/remote-graph?${q.toString()}`, opts.signal)
}
