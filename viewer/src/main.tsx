import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { indexFiles } from './indexer'
import { indexGithubRepo } from './indexer/github'

// No StrictMode: it double-invokes effects in dev, which would spin up two
// EventSource/WebGL contexts. The build is the product here, not a dev session.
createRoot(document.getElementById('root')!).render(<App />)

// Dev/test hooks: prove the engine indexes in the browser. `openvisioIndex(files)`
// runs web-tree-sitter on in-memory files; `openvisioIndexGithub(url)` fetches a
// repo from GitHub (no server) and indexes it. Both return the GraphResponse.
Object.assign(window as object, { openvisioIndex: indexFiles, openvisioIndexGithub: indexGithubRepo })
