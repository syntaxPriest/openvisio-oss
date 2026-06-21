// OpenVisio local viewer — vanilla JS, Canvas 2D, zero dependencies. Fetches the
// deterministic graph from the local server (GET /api/graph?path=<repo>) and
// draws files at their precomputed layout positions, colored by language, with
// import edges. Pan/zoom, search, language filter, and a selection panel. This
// renders the exact same graph the MCP serves to coding agents.

'use strict'

// Language → color. Mirrors the engine's language set; anything unmapped is gray.
const LANG_COLORS = {
  typescript: '#3178c6', javascript: '#f1e05a', python: '#3572A5', go: '#00ADD8',
  rust: '#dea584', java: '#b07219', c: '#555555', cpp: '#f34b7d', csharp: '#178600',
  kotlin: '#A97BFF', ruby: '#701516', php: '#4F5D95', swift: '#F05138', scala: '#c22d40',
  dart: '#00B4AB', zig: '#ec915c', lua: '#000080', r: '#198CE7', elixir: '#6e4a7e',
  elm: '#60B5CC', ocaml: '#3be133', solidity: '#AA6746', objc: '#438eff', bash: '#89e051',
  vue: '#41b883', html: '#e34c26', css: '#563d7c', json: '#cbcb41', yaml: '#cb171e',
  toml: '#9c4221', markdown: '#74a0c0', twig: '#9bbd5e', blade: '#f7523f', eda: '#ff8c00',
  other: '#6e7681',
}
const colorFor = (lang) => LANG_COLORS[lang] || LANG_COLORS.other

// ── DOM ──
const canvas = document.getElementById('graph')
const ctx = canvas.getContext('2d')
const tooltip = document.getElementById('tooltip')
const overlay = document.getElementById('overlay')
const statsEl = document.getElementById('stats')
const legendEl = document.getElementById('legend')
const repoNameEl = document.getElementById('repo-name')
const detailsPanel = document.getElementById('details-panel')
const detailsEl = document.getElementById('details')
const searchEl = document.getElementById('search')
const edgesToggle = document.getElementById('edges-toggle')
const pathInput = document.getElementById('path-input')
const indexForm = document.getElementById('index-form')
const indexBtn = document.getElementById('index-btn')

// ── State ──
const state = {
  nodes: [],            // {id, path, lang, loc, x, y, r}  (x/y in layout space)
  edges: [],            // {a: nodeIndex, b: nodeIndex}    (import edges, file-level)
  byId: new Map(),      // file id → node
  byPath: new Map(),    // repo-relative path → node (for spotlight lookups)
  inDeg: new Map(),     // file id → imported-by count
  outDeg: new Map(),    // file id → imports count
  spotlight: { focus: new Set(), edges: new Set(), tool: '', active: false }, // live agent highlight
  view: { scale: 1, tx: 0, ty: 0 },
  selected: null,       // node or null
  hover: null,          // node or null
  query: '',
  hiddenLangs: new Set(),
  showEdges: true,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
}

// ── Sizing ──
function resize() {
  const wrap = canvas.parentElement
  const w = wrap.clientWidth
  const h = wrap.clientHeight
  canvas.width = Math.round(w * state.dpr)
  canvas.height = Math.round(h * state.dpr)
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  draw()
}
window.addEventListener('resize', resize)

// ── Data load ──
async function indexRepo(repoPath) {
  showOverlay('Indexing ' + repoPath + ' …')
  indexBtn.disabled = true
  try {
    const res = await fetch('/api/graph?path=' + encodeURIComponent(repoPath))
    const body = await res.json()
    if (!res.ok) throw new Error(body && body.error ? body.error : 'index failed (' + res.status + ')')
    ingest(body.graph)
    hideOverlay()
  } catch (err) {
    showError(String(err && err.message ? err.message : err))
  } finally {
    indexBtn.disabled = false
  }
}

// Turn the wire GraphResponse into render-ready nodes/edges.
function ingest(graph) {
  const pos = new Map()
  for (const n of graph.layout.nodes) pos.set(n.id, n)
  state.byId.clear(); state.byPath.clear(); state.inDeg.clear(); state.outDeg.clear()
  state.nodes = []
  for (const f of graph.files) {
    const p = pos.get(f.id)
    if (!p) continue // no layout position → skip (isolated/filtered upstream)
    const node = { id: f.id, path: f.path, lang: f.language, loc: f.loc, x: p.x, y: p.y, r: radiusFor(f.loc) }
    state.nodes.push(node)
    state.byId.set(f.id, node)
    state.byPath.set(f.path, node)
  }
  state.edges = []
  for (const e of graph.edges) {
    if (e.edge_kind !== 'import') continue // file map shows imports, not symbol calls
    const a = state.byId.get(e.source_id)
    const b = state.byId.get(e.target_id)
    if (!a || !b) continue
    state.edges.push({ a, b })
    state.outDeg.set(a.id, (state.outDeg.get(a.id) || 0) + 1)
    state.inDeg.set(b.id, (state.inDeg.get(b.id) || 0) + 1)
  }
  state.selected = null
  detailsPanel.hidden = true

  // Header + sidebar
  const repo = graph.repo
  repoNameEl.textContent = repo.name || repo.root_path
  statsEl.innerHTML =
    '<b>' + repo.file_count + '</b> files · <b>' + state.edges.length + '</b> imports · <b>' +
    repo.total_loc.toLocaleString() + '</b> loc'
  buildLegend()
  fitView()
}

const radiusFor = (loc) => Math.max(2.5, Math.min(16, 2 + Math.sqrt(loc || 1) / 3))

// Per-language file + loc tallies, sorted by loc desc — same shape as the
// get_languages MCP tool, rendered as a clickable filter legend.
function buildLegend() {
  const tally = new Map()
  for (const n of state.nodes) {
    const t = tally.get(n.lang) || { files: 0, loc: 0 }
    t.files++; t.loc += n.loc; tally.set(n.lang, t)
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1].loc - a[1].loc || b[1].files - a[1].files)
  legendEl.innerHTML = ''
  for (const [lang, t] of ranked) {
    const li = document.createElement('li')
    if (state.hiddenLangs.has(lang)) li.classList.add('off')
    li.innerHTML =
      '<span class="swatch" style="background:' + colorFor(lang) + '"></span>' +
      '<span class="lang">' + lang + '</span>' +
      '<span class="count">' + t.files + ' · ' + t.loc.toLocaleString() + '</span>'
    li.addEventListener('click', () => {
      if (state.hiddenLangs.has(lang)) state.hiddenLangs.delete(lang)
      else state.hiddenLangs.add(lang)
      buildLegend(); draw()
    })
    legendEl.appendChild(li)
  }
}

// ── View fitting ──
function fitView() {
  if (state.nodes.length === 0) { draw(); return }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of state.nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y
  }
  const w = canvas.width, h = canvas.height
  const pad = 40 * state.dpr
  const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY)
  const scale = Math.min((w - pad * 2) / gw, (h - pad * 2) / gh)
  state.fitScale = scale
  state.view.scale = scale
  state.view.tx = (w - scale * (minX + maxX)) / 2
  state.view.ty = (h - scale * (minY + maxY)) / 2
  draw()
}

// Center the view on a node and select it, zooming in if we're at the far-out
// fit scale so the node + its neighbors are legible.
function focusNode(node) {
  if (!node) return
  state.selected = node
  state.view.scale = Math.max(state.view.scale, (state.fitScale || state.view.scale) * 3)
  state.view.tx = canvas.width / 2 - node.x * state.view.scale
  state.view.ty = canvas.height / 2 - node.y * state.view.scale
  renderDetails(node)
  draw()
}

// Best node match for a query: prefer an exact filename, else shortest path that
// contains it (the least-nested, most likely "the" file).
function bestMatch(q) {
  q = q.toLowerCase()
  let exact = null, contains = null
  for (const n of state.nodes) {
    if (state.hiddenLangs.has(n.lang)) continue
    const p = n.path.toLowerCase()
    const base = p.split('/').pop()
    if (base === q || base === q.split('/').pop()) { if (!exact || n.path.length < exact.path.length) exact = n }
    else if (p.includes(q)) { if (!contains || n.path.length < contains.path.length) contains = n }
  }
  return exact || contains
}

// Layout-space → device-pixel screen coords.
const sx = (x) => x * state.view.scale + state.view.tx
const sy = (y) => y * state.view.scale + state.view.ty

// ── Rendering ──
function isVisible(node) {
  if (state.hiddenLangs.has(node.lang)) return false
  if (state.query && !node.path.toLowerCase().includes(state.query)) return false
  return true
}

const EDGE_KEY = (a, b) => a + ' ' + b

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (state.nodes.length === 0) return

  // The live agent spotlight takes visual precedence over manual selection while
  // it's active (a tool call just landed); otherwise selection drives emphasis.
  const spot = state.spotlight.active ? state.spotlight : null
  const sel = spot ? null : state.selected
  const neighbors = sel ? neighborSet(sel) : null
  const emphasized = (n) => (spot ? spot.focus.has(n.id) : sel ? n === sel || (neighbors && neighbors.has(n.id)) : true)
  const focusMode = Boolean(spot || sel)

  // Edges first (under nodes). Active edges (the agent's, or the selection's)
  // brighten; the rest mute so local structure reads against the global graph.
  if (state.showEdges) {
    for (const e of state.edges) {
      if (!isVisible(e.a) || !isVisible(e.b)) continue
      const active = spot
        ? spot.edges.has(EDGE_KEY(e.a.path, e.b.path)) || spot.edges.has(EDGE_KEY(e.b.path, e.a.path))
        : sel && (e.a === sel || e.b === sel)
      ctx.lineWidth = (active ? 1.4 : 0.6) * state.dpr
      ctx.strokeStyle = active
        ? spot ? 'rgba(245,158,11,0.9)' : 'rgba(79,156,255,0.85)'
        : focusMode ? 'rgba(120,140,165,0.06)' : 'rgba(120,140,165,0.28)'
      ctx.beginPath()
      ctx.moveTo(sx(e.a.x), sy(e.a.y))
      ctx.lineTo(sx(e.b.x), sy(e.b.y))
      ctx.stroke()
    }
  }

  // Nodes.
  for (const n of state.nodes) {
    const vis = isVisible(n)
    const emph = emphasized(n)
    const dim = !vis || (focusMode && !emph)
    const spotFocus = spot && spot.focus.has(n.id)
    const r = n.r * state.dpr * (spotFocus ? 1.7 : n === sel ? 1.6 : 1)
    ctx.globalAlpha = dim ? 0.16 : 1
    ctx.fillStyle = colorFor(n.lang)
    ctx.beginPath()
    ctx.arc(sx(n.x), sy(n.y), r, 0, Math.PI * 2)
    ctx.fill()
    if (spotFocus || n === sel || n === state.hover) {
      ctx.globalAlpha = 1
      ctx.lineWidth = (spotFocus ? 2 : 1.5) * state.dpr
      ctx.strokeStyle = spotFocus ? '#f59e0b' : '#fff'
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // Labels: the agent's focus, the selection + its neighbors, and big nodes when
  // zoomed in.
  ctx.font = (11 * state.dpr) + 'px ui-monospace, monospace'
  ctx.fillStyle = '#e6edf3'
  ctx.textBaseline = 'middle'
  for (const n of state.nodes) {
    if (!isVisible(n)) continue
    const labelled =
      (spot && spot.focus.has(n.id)) ||
      n === sel ||
      (neighbors && neighbors.has(n.id)) ||
      (state.view.scale > 2.2 && n.r > 6)
    if (!labelled) continue
    const name = n.path.split('/').pop()
    ctx.fillText(name, sx(n.x) + n.r * state.dpr + 4, sy(n.y))
  }
}

function neighborSet(node) {
  const set = new Set()
  for (const e of state.edges) {
    if (e.a === node) set.add(e.b.id)
    else if (e.b === node) set.add(e.a.id)
  }
  return set
}

// ── Hit testing ──
function nodeAt(px, py) {
  // px/py are device pixels. Search nearest within its radius (+ slack).
  let best = null, bestD = Infinity
  for (const n of state.nodes) {
    if (!isVisible(n)) continue
    const dx = sx(n.x) - px, dy = sy(n.y) - py
    const d = dx * dx + dy * dy
    const rr = Math.pow(n.r * state.dpr + 4 * state.dpr, 2)
    if (d <= rr && d < bestD) { best = n; bestD = d }
  }
  return best
}

// ── Interaction ──
let dragging = false, dragMoved = false, lastX = 0, lastY = 0
canvas.addEventListener('mousedown', (e) => {
  dragging = true; dragMoved = false
  lastX = e.clientX; lastY = e.clientY
  canvas.classList.add('dragging')
})
window.addEventListener('mouseup', () => { dragging = false; canvas.classList.remove('dragging') })
window.addEventListener('mousemove', (e) => {
  if (!dragging) return
  const dx = (e.clientX - lastX) * state.dpr, dy = (e.clientY - lastY) * state.dpr
  if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 3) dragMoved = true
  state.view.tx += dx; state.view.ty += dy
  lastX = e.clientX; lastY = e.clientY
  draw()
})

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect()
  const px = (e.clientX - rect.left) * state.dpr, py = (e.clientY - rect.top) * state.dpr
  const hit = dragging ? null : nodeAt(px, py)
  if (hit !== state.hover) { state.hover = hit; draw() }
  if (hit) {
    tooltip.hidden = false
    tooltip.style.left = (e.clientX - rect.left + 14) + 'px'
    tooltip.style.top = (e.clientY - rect.top + 14) + 'px'
    tooltip.innerHTML =
      '<div class="t-path">' + hit.path + '</div>' +
      '<div class="t-meta">' + hit.lang + ' · ' + hit.loc + ' loc · imports ' +
      (state.outDeg.get(hit.id) || 0) + ' · imported by ' + (state.inDeg.get(hit.id) || 0) + '</div>'
  } else {
    tooltip.hidden = true
  }
})
canvas.addEventListener('mouseleave', () => { state.hover = null; tooltip.hidden = true; draw() })

canvas.addEventListener('click', (e) => {
  if (dragMoved) return
  const rect = canvas.getBoundingClientRect()
  const px = (e.clientX - rect.left) * state.dpr, py = (e.clientY - rect.top) * state.dpr
  const hit = nodeAt(px, py)
  state.selected = hit
  renderDetails(hit)
  draw()
})

canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const px = (e.clientX - rect.left) * state.dpr, py = (e.clientY - rect.top) * state.dpr
  const factor = Math.exp(-e.deltaY * 0.0015)
  const next = Math.max(0.05, Math.min(40, state.view.scale * factor))
  const k = next / state.view.scale
  // Zoom about the cursor: keep the layout point under the cursor fixed.
  state.view.tx = px - k * (px - state.view.tx)
  state.view.ty = py - k * (py - state.view.ty)
  state.view.scale = next
  draw()
}, { passive: false })

function renderDetails(node) {
  if (!node) { detailsPanel.hidden = true; return }
  detailsPanel.hidden = false
  const imports = []
  const importedBy = []
  for (const e of state.edges) {
    if (e.a === node) imports.push(e.b.path)
    else if (e.b === node) importedBy.push(e.a.path)
  }
  const list = (label, arr) => {
    if (arr.length === 0) return ''
    const shown = arr.slice(0, 6).map((p) => '<div>' + p + '</div>').join('')
    const more = arr.length > 6 ? '<div>… +' + (arr.length - 6) + ' more</div>' : ''
    return '<div class="neighbors"><b>' + label + ' (' + arr.length + ')</b>' + shown + more + '</div>'
  }
  detailsEl.innerHTML =
    '<div class="file-path">' + node.path + '</div>' +
    '<div class="row"><span>language</span><b>' + node.lang + '</b></div>' +
    '<div class="row"><span>lines</span><b>' + node.loc + '</b></div>' +
    list('imports', imports) + list('imported by', importedBy)
}

// ── Controls ──
searchEl.addEventListener('input', () => { state.query = searchEl.value.trim().toLowerCase(); draw() })
searchEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const match = bestMatch(searchEl.value.trim())
  if (!match) return
  // Jump to the file: clear the text filter so its neighbors stay visible, then
  // select + center it.
  searchEl.value = ''
  state.query = ''
  focusNode(match)
})
edgesToggle.addEventListener('change', () => { state.showEdges = edgesToggle.checked; draw() })
indexForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const p = pathInput.value.trim()
  if (!p) return
  const url = new URL(location.href)
  url.searchParams.set('path', p)
  history.replaceState(null, '', url)
  indexRepo(p)
})

// ── Overlay helpers ──
function showOverlay(msg) { overlay.hidden = false; overlay.classList.remove('error'); overlay.textContent = msg }
function hideOverlay() { overlay.hidden = true }
function showError(msg) { overlay.hidden = false; overlay.classList.add('error'); overlay.textContent = 'Error: ' + msg }

// ── Live agent spotlight ──
// This page is served by the same process that hosts the spotlight hub, so we
// subscribe same-origin. When a coding agent runs `openvisio mcp --spotlight`
// against this port, each tool call broadcasts the files/edges it touched; we
// pulse them amber. Quiet when no agent is attached.
const agentDot = document.getElementById('agent-status')
let spotlightFade = null
function setAgent(stateName, tool) {
  if (!agentDot) return
  agentDot.className = 'agent ' + stateName
  agentDot.textContent = stateName === 'live' ? '● ' + (tool || 'agent') : stateName === 'idle' ? '○ stream' : ''
  agentDot.hidden = stateName === 'off'
}
function applySpotlight(data) {
  // Ignore the bus's replayed "last event" if it's stale (avoids a flash of an
  // old highlight when the page connects mid-session).
  if (data.ts && Date.now() - data.ts > 15000) return
  const focus = new Set()
  for (const p of data.focus || []) { const n = state.byPath.get(p); if (n) focus.add(n.id) }
  const edges = new Set()
  for (const pair of data.edges || []) if (Array.isArray(pair) && pair.length === 2) edges.add(EDGE_KEY(pair[0], pair[1]))
  state.spotlight = { focus, edges, tool: data.tool || 'agent', active: focus.size > 0 || edges.size > 0 }
  setAgent('live', state.spotlight.tool)
  draw()
  if (spotlightFade) clearTimeout(spotlightFade)
  spotlightFade = setTimeout(() => { state.spotlight.active = false; setAgent('idle'); draw() }, 5000)
}
function connectSpotlight() {
  if (typeof EventSource === 'undefined') return
  let es
  try { es = new EventSource('/api/spotlight') } catch { return }
  es.addEventListener('spotlight', (ev) => {
    let data
    try { data = JSON.parse(ev.data) } catch { return }
    if (!data || data.v !== 1) return
    if (data.kind && data.kind !== 'highlight') return // queued/consumed/answer aren't visualized here
    applySpotlight(data)
  })
  es.onopen = () => { if (!state.spotlight.active) setAgent('idle') }
  es.onerror = () => setAgent('off')
}

// ── Boot ──
resize()
connectSpotlight()
const initial = new URLSearchParams(location.search).get('path')
if (initial) {
  pathInput.value = initial
  indexRepo(initial)
} else {
  showOverlay('Enter a local repo path above and press Index.')
}
