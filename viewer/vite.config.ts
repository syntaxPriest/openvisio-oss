import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import * as path from 'node:path'

// Standalone SPA build. The `@` alias mirrors the app's alias so the Atlas/City
// source files are copied in VERBATIM (no import rewriting). Output is a
// self-contained dist/ (single JS+CSS bundle) served by `openvisio view`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  base: './', // assets referenced relative, so the static server can host at /
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000, // three.js is large; this is expected
  },
})
