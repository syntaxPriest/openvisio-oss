import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

// No StrictMode: it double-invokes effects in dev, which would spin up two
// EventSource/WebGL contexts. The build is the product here, not a dev session.
createRoot(document.getElementById('root')!).render(<App />)
