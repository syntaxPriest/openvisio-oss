import { Workspace } from '@/components/workspace/Workspace'

// The app shell, served for /workspace and every view extension
// (/workspace/narrator, /workspace/city, /workspace/graph/<group>, …). The
// Workspace reads the pathname to restore the active view on a hard reload; API
// routes under /api take precedence. The marketing landing is the separate "/"
// route.
export default function WorkspacePage() {
  return <Workspace />
}
