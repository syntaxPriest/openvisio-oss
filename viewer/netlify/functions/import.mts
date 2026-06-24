// Transport endpoint for the hosted viewer. `openvisio transport` POSTs a
// pre-computed graph JSON here; the viewer GETs it back by id via /?g=<id>. The
// server stores + serves — it never indexes or sees source. Storage is Netlify
// Blobs (free tier), so this whole thing runs on Netlify's no-cost plan.

import { getStore, type Store } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'

// Netlify Functions cap a synchronous request body at ~6 MB; reject larger
// graphs with a clear pointer (they should index a smaller subtree, or we add
// gzip later). Measured in BYTES — `string.length` counts UTF-16 code units, so
// a graph with multibyte content could slip past a length check and then get
// killed by the platform as an opaque 500.
const MAX_BYTES = 6 * 1024 * 1024

/** Build a clean Response from a thrown value, logging the real cause server-side. */
function storageError(label: string, err: unknown): Response {
  console.error(`openvisio import: ${label}`, err)
  const detail = err instanceof Error ? err.message : String(err)
  // 502, not 500: the function ran fine; its upstream (Blobs) is what failed.
  return Response.json({ error: `${label}: ${detail}` }, { status: 502 })
}

/**
 * Core request handler, parameterized over the blob store so it can be exercised
 * without a live Netlify Blobs backend. The default export wires in the real store.
 */
export async function handleImport(req: Request, store: Store): Promise<Response> {
  const origin = new URL(req.url).origin

  if (req.method === 'POST') {
    const body = await req.text()
    if (Buffer.byteLength(body) > MAX_BYTES) {
      return Response.json({ error: 'graph too large for upload (> 6 MB)' }, { status: 413 })
    }
    try {
      JSON.parse(body) // reject junk early
    } catch {
      return Response.json({ error: 'body is not valid JSON' }, { status: 400 })
    }
    const id = randomUUID().replace(/-/g, '').slice(0, 10)
    try {
      await store.set(id, body, { metadata: { name: req.headers.get('x-openvisio-name') ?? '', ts: Date.now() } })
    } catch (err) {
      return storageError('storage write failed', err)
    }
    return Response.json({ id, url: `${origin}/?g=${id}` }, { status: 201 })
  }

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 })
    let data: string | null
    try {
      data = await store.get(id, { type: 'text' })
    } catch (err) {
      return storageError('storage read failed', err)
    }
    if (!data) return Response.json({ error: 'graph not found or expired' }, { status: 404 })
    return new Response(data, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    })
  }

  return new Response('method not allowed', { status: 405 })
}

export default async (req: Request): Promise<Response> => {
  let store: Store
  try {
    // getStore is lazy today, but guard it anyway: if the deploy has no Blobs
    // context wired up, this is the first place it can surface — and an opaque
    // 500 here is exactly the failure we're trying to make legible.
    store = getStore('graphs')
  } catch (err) {
    return storageError('storage unavailable', err)
  }
  return handleImport(req, store)
}

// Netlify Functions v2: route this function directly at /api/import.
export const config = { path: '/api/import' }
