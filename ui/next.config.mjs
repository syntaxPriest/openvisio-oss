import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compress: true,
  // This app has its own lockfile and isn't part of the core/mcp workspace, so
  // pin the tracing root here to keep Next from inferring a parent directory.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // The views live under /workspace. Redirect the old root-level view paths so
  // existing bookmarks/links keep working.
  async redirects() {
    return [
      { source: '/city', destination: '/workspace/city', permanent: true },
      { source: '/atlas', destination: '/workspace/atlas', permanent: true },
    ]
  },
}

export default nextConfig
