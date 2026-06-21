// URL ↔ view mapping for the workspace. The app lives under /workspace, and each
// view is a real, reloadable path:
//   /workspace        → base (open-repo empty state)
//   /workspace/city   → city
//   /workspace/atlas  → atlas
// The viewer keeps its in-memory graph; the URL is just a reflection driven via
// history.replaceState, and parsed back on a hard reload.

import type { WorkspaceMode } from '@/components/workspace/ModeTabs'

/** The base path the workspace lives under. */
export const WORKSPACE_BASE = '/workspace'

export interface ViewRoute {
  mode: WorkspaceMode
}

/** Parse a pathname into a view, or null for the base ("/workspace") or any
 *  non-workspace path. */
export function parseView(pathname: string): ViewRoute | null {
  let rest: string
  if (pathname === WORKSPACE_BASE) rest = ''
  else if (pathname.startsWith(`${WORKSPACE_BASE}/`)) rest = pathname.slice(WORKSPACE_BASE.length)
  else return null // not a workspace path

  const segs = rest.split('/').filter(Boolean)
  if (segs.length === 0) return null // base
  switch (segs[0]) {
    case 'city':
      return { mode: 'city' }
    case 'atlas':
      return { mode: 'atlas' }
    default:
      return null
  }
}

/** Build the pathname for a view (always under /workspace). */
export function pathForView(mode: WorkspaceMode): string {
  return `${WORKSPACE_BASE}/${mode}`
}
