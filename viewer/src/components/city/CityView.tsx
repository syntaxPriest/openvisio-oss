'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { GizmoHelper, GizmoViewcube, Html, Line, OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import { Minus, Plus, Share2, Crosshair, Palette } from 'lucide-react'
import type { FileHistory, GraphResponse, Language } from '@/lib/api/types'
import { folderLabel, shortName } from '@/components/graph/encoding'
import { capFileGraph } from '@/lib/graph/capGraph'
import { cn } from '@/lib/utils'
import {
  buildCityLayout,
  COLOR_MODES,
  FILE_TYPE_LABELS,
  fileType,
  fileTypeColor,
  languageColor,
  metricLegend,
  resolveCityColor,
  type BuildingT,
  type CityLayoutT,
  type ColorMode,
  type FileType,
  type LegendBand,
} from './cityLayout'
import type { Line2 as Line2Impl, OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { isTypingTarget } from '@/lib/utils/keyboardNav'

export interface CityViewProps {
  graph: GraphResponse
  focusedFileId: number | null
  citations: Map<number, number>
  onFocus: (fileId: number | null) => void
  // Only respond to keyboard nav when the city is the visible mode; also gates
  // the render loop (frameloop) so an off-screen embed costs ~0 GPU.
  active?: boolean
  // Hide all chrome (widgets, legend, pills, gizmo, hint) for a decorative
  // embed — e.g. a landing-page showcase panel.
  embed?: boolean
  // Skip the cream backdrop so the city floats on the page behind it.
  transparentBg?: boolean
  // Restrict interaction to orbiting only — no zoom (which would hijack page
  // scroll in an embed) and no pan.
  rotateOnly?: boolean
  // Scales the initial camera distance: <1 frames the city larger. Embeds use
  // this to fill their panel; the app keeps the default comfortable margin.
  fit?: number
}

const BG = '#F4F1E8' // light cream — codecharta-ish ground around the city
const GROUND_DARK = '#1B1D22' // dark plinth under the buildings

// Performance ceilings for big repos. Each building was 2–3 three.js meshes + a
// troika text label; uncapped that pins RAM/GPU and can lock a laptop.
//   - CITY_FILE_CAP: hard cap on buildings (most-connected kept, rest dropped).
//   - CITY_SHADOW_MAX: above this, shadows are disabled (the shadow map + every
//     building rendering into it is a major cost).
//   - CITY_LABEL_BUDGET: only the N largest base buildings get rooftop labels;
//     labels (troika SDF geometry per name) are the single heaviest per-building
//     cost. Focused/connected buildings are always labelled regardless.
//   - CITY_EDGE_CAP: when nothing is focused, only the heaviest N imports draw.
const CITY_FILE_CAP = 1500
const CITY_SHADOW_MAX = 1200
const CITY_LABEL_BUDGET = 140
const CITY_EDGE_CAP = 400

interface ViewportInfo {
  cameraPos: [number, number, number]
  distance: number
  azimuth: number
  polar: number
}

export function CityView({ graph: rawGraph, focusedFileId, citations, onFocus, active = true, embed = false, transparentBg = false, rotateOnly = false, fit = 1 }: CityViewProps) {
  // Cap before laying out the city so every downstream derivation is bounded.
  const capped = useMemo(() => capFileGraph(rawGraph, CITY_FILE_CAP), [rawGraph])
  const graph = capped.graph
  const layout = useMemo(() => buildCityLayout(graph), [graph])
  const shadowsOn = layout.buildings.length <= CITY_SHADOW_MAX
  const [hovered, setHovered] = useState<number | null>(null)
  const [showEdges, setShowEdges] = useState(true)
  const [colorMode, setColorMode] = useState<ColorMode>('language')

  const colorCtx = useMemo(
    () => ({ maxLoc: layout.maxLoc, maxHotness: layout.maxHotness, historyByFile: layout.historyByFile }),
    [layout.maxLoc, layout.maxHotness, layout.historyByFile],
  )

  const buildingColors = useMemo(() => {
    const m = new Map<number, string>()
    for (const b of layout.buildings) m.set(b.file.id, resolveCityColor(b.file, colorMode, colorCtx))
    return m
  }, [layout.buildings, colorMode, colorCtx])

  const controlsRef = useRef<OrbitControlsImpl | null>(null)

  // Index every (source → target) file pair by its raw weight, so an edge
  // tooltip can show "N imports" rather than just an edge id.
  const edgeWeightByPair = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of graph.edges) {
      if (e.edge_kind !== 'import') continue
      m.set(`${e.source_id}->${e.target_id}`, Math.max(1, e.weight ?? 1))
    }
    return m
  }, [graph.edges])

  // Per-file import degree (fan-in / fan-out), so the focused-building label can
  // show the same deterministic numbers the graph card does — "ask about what
  // you see" without leaving the City.
  const degreeByFile = useMemo(() => {
    const m = new Map<number, { in: number; out: number }>()
    for (const e of graph.edges) {
      if (e.edge_kind !== 'import' || e.source_kind !== 'file' || e.target_kind !== 'file') continue
      const s = m.get(e.source_id) ?? { in: 0, out: 0 }
      s.out++
      m.set(e.source_id, s)
      const t = m.get(e.target_id) ?? { in: 0, out: 0 }
      t.in++
      m.set(e.target_id, t)
    }
    return m
  }, [graph.edges])

  // When something's focused, the files at the other end of its edges are its
  // direct neighbours — we light them up (amber, scaled by import strength) and
  // fade the rest, so you can trace connections by eye. Mirrors the graph view.
  const { connectedFileIds, neighborWeight, maxNeighborWeight } = useMemo(() => {
    const ids = new Set<number>()
    const weight = new Map<number, number>()
    if (focusedFileId === null) return { connectedFileIds: ids, neighborWeight: weight, maxNeighborWeight: 1 }
    for (const e of graph.edges) {
      if (e.edge_kind !== 'import' || e.source_kind !== 'file' || e.target_kind !== 'file') continue
      const other = e.source_id === focusedFileId ? e.target_id : e.target_id === focusedFileId ? e.source_id : null
      if (other === null) continue
      ids.add(other)
      weight.set(other, (weight.get(other) ?? 0) + (e.weight || 1))
    }
    return { connectedFileIds: ids, neighborWeight: weight, maxNeighborWeight: Math.max(1, ...weight.values()) }
  }, [focusedFileId, graph.edges])

  useCityKeyboard(active, controlsRef)

  const center: [number, number, number] = [layout.size.w / 2, 0, layout.size.d / 2]
  // Frame the whole city with margin — fov is 45°, so 1.5× the largest side
  // is a comfortable fit, then we lift the camera for an isometric-ish read.
  const baseDistance = Math.max(layout.size.w, layout.size.d) * 1.5 * fit
  const minDist = baseDistance * 0.15
  const maxDist = baseDistance * 4
  const initialCam: [number, number, number] = [
    center[0] + baseDistance * 0.65,
    baseDistance * 0.55,
    center[2] + baseDistance * 0.65,
  ]

  const [viewport, setViewport] = useState<ViewportInfo>({
    cameraPos: initialCam,
    distance: baseDistance,
    azimuth: 45,
    polar: 60,
  })

  // Zoom percent: 100% = baseDistance. Smaller distance = larger %.
  const zoomPct = Math.round((baseDistance / Math.max(viewport.distance, 0.001)) * 100)

  const setDistance = useCallback(
    (next: number) => {
      const controls = controlsRef.current
      if (!controls) return
      const cam = controls.object as THREE.PerspectiveCamera
      const target = controls.target
      const dir = new THREE.Vector3().subVectors(cam.position, target)
      const len = dir.length() || 1
      dir.divideScalar(len)
      const clamped = Math.max(minDist, Math.min(maxDist, next))
      cam.position.copy(target).addScaledVector(dir, clamped)
      controls.update()
    },
    [minDist, maxDist],
  )

  const handleZoomIn = useCallback(() => setDistance(viewport.distance * 0.8), [setDistance, viewport.distance])
  const handleZoomOut = useCallback(() => setDistance(viewport.distance * 1.25), [setDistance, viewport.distance])
  const handleZoomSlider = useCallback(
    (pct: number) => {
      // pct 0 → maxDist (way out); pct 100 → minDist (close in)
      const t = Math.max(0, Math.min(1, pct / 100))
      const d = THREE.MathUtils.lerp(maxDist, minDist, t)
      setDistance(d)
    },
    [minDist, maxDist, setDistance],
  )

  const focusedBuilding =
    focusedFileId !== null ? layout.buildingByFileId.get(focusedFileId) ?? null : null

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: transparentBg ? 'transparent' : BG }}>
      {/* Top-right widget cluster — gizmo + zoom slider */}
      {embed ? null : (
      <div className="pointer-events-auto absolute right-6 top-5 z-10 flex flex-col items-end gap-3">
        <button
          type="button"
          onClick={() => controlsRef.current?.reset?.()}
          title="Reset view"
          className="grid size-9 place-items-center rounded-full bg-[color:var(--color-accent)] text-white shadow-[0_4px_14px_rgba(0,0,0,0.18)] transition-transform hover:scale-105"
        >
          <Crosshair size={15} strokeWidth={2} />
        </button>
        {/* Placeholder for gizmo — actual gizmo is inside Canvas via GizmoHelper.
            We just reserve a slot here so layout doesn't jump. */}
        <div className="size-[88px]" aria-hidden />
        <ZoomSlider
          pct={Math.max(0, Math.min(100, Math.round(((maxDist - viewport.distance) / (maxDist - minDist)) * 100)))}
          onChange={handleZoomSlider}
          onMinus={handleZoomOut}
          onPlus={handleZoomIn}
          displayPct={zoomPct}
        />
        <button
          type="button"
          onClick={() => setShowEdges((v) => !v)}
          title={showEdges ? 'Hide imports' : 'Show imports'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            showEdges
              ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white'
              : 'border-black/15 bg-white text-black/70 hover:border-black/40 hover:text-black',
          )}
        >
          <Share2 size={12} strokeWidth={2} />
          imports
        </button>
        <ColorModePicker mode={colorMode} onChange={setColorMode} />
      </div>
      )}

      {/* Adaptive legend — categorical for language/file_type, gradient for loc/hotness. */}
      {embed ? null : <ColorLegend mode={colorMode} graph={graph} layout={layout} />}

      {/* Bottom-left: viewport vector readout — small, compact */}
      {embed ? null : <ViewportPill info={viewport} />}

      {/* Large-repo notice: we capped the buildings to keep the city renderable. */}
      {!embed && capped.truncated ? (
        <div
          className="pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 rounded-full border border-black/10 bg-white/95 px-3 py-1.5 font-mono text-[10px] text-black/70 shadow-[0_4px_14px_rgba(0,0,0,0.08)] backdrop-blur-sm"
          title={`Large repo — showing the ${capped.shownFiles} most-connected files to keep the city renderable`}
        >
          showing {capped.shownFiles.toLocaleString()} of {capped.totalFiles.toLocaleString()} files
        </div>
      ) : null}

      {/* Focused file pill — bottom-center, only when focused */}
      {!embed && focusedBuilding ? (
        <FocusedPill building={focusedBuilding} onClear={() => onFocus(null)} />
      ) : null}

      <Canvas
        frameloop={active ? 'always' : 'never'}
        shadows={shadowsOn}
        dpr={[1, 2]}
        camera={{ position: initialCam, fov: 45, near: 0.1, far: baseDistance * 6 }}
        onPointerMissed={() => onFocus(null)}
        gl={{ toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
      >
        {transparentBg ? null : <color attach="background" args={[BG]} />}
        <ambientLight intensity={1.2} />
        <directionalLight
          position={[layout.size.w * 0.6, layout.size.w * 1.2, layout.size.d * 0.6]}
          intensity={0.8}
          castShadow={shadowsOn}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-layout.size.w}
          shadow-camera-right={layout.size.w}
          shadow-camera-top={layout.size.d}
          shadow-camera-bottom={-layout.size.d}
        />
        <directionalLight position={[-layout.size.w * 0.4, layout.size.w * 0.4, -layout.size.d * 0.4]} intensity={0.35} />

        <Suspense fallback={null}>
          <CityBase width={layout.size.w} depth={layout.size.d} />
          <DistrictLabels districts={layout.districts} />
          <Buildings
            layout={layout}
            focusedFileId={focusedFileId}
            connectedFileIds={connectedFileIds}
            neighborWeight={neighborWeight}
            maxNeighborWeight={maxNeighborWeight}
            citations={citations}
            hovered={hovered}
            onHover={setHovered}
            onClick={onFocus}
            buildingColors={buildingColors}
            shadowsOn={shadowsOn}
          />
          {showEdges ? (
            <Edges
              layout={layout}
              focusedFileId={focusedFileId}
              edgeWeightByPair={edgeWeightByPair}
            />
          ) : null}
          <FocusedLabel
            building={focusedBuilding}
            degree={focusedBuilding ? degreeByFile.get(focusedBuilding.file.id) : undefined}
            history={focusedBuilding ? layout.historyByFile.get(focusedBuilding.file.id) : undefined}
          />
          {hovered !== null && hovered !== focusedFileId ? (
            <HoverLabel building={layout.buildingByFileId.get(hovered) ?? null} />
          ) : null}
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          target={center}
          makeDefault
          enableDamping={false}
          enablePan={!rotateOnly}
          enableRotate
          enableZoom={!rotateOnly}
          screenSpacePanning
          rotateSpeed={1.1}
          panSpeed={1.2}
          zoomSpeed={1.2}
          minDistance={minDist}
          maxDistance={maxDist}
          maxPolarAngle={Math.PI * 0.495}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          touches={{
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />
        <ViewportReporter onChange={setViewport} />
        {embed ? null : (
          <GizmoHelper alignment="top-right" margin={[112, 100]}>
            <GizmoViewcube
              color="#D3CFC0"
              opacity={1}
              strokeColor="#6B6B6B"
              textColor="#1B1D22"
              faces={['R', 'L', 'U', 'D', 'F', 'B']}
              hoverColor="var(--color-accent)"
            />
          </GizmoHelper>
        )}
      </Canvas>

      {/* Subtle controls hint */}
      {embed ? null : (
        <div className="pointer-events-none absolute bottom-4 right-6 z-10 flex flex-col items-end gap-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-black/35">
          <span>drag · rotate ⌥ scroll · zoom ⌥ right-drag · pan</span>
          <span>
            <Kbd>↑↓←→</Kbd> pan · <Kbd>⇧</Kbd>+<Kbd>↑↓←→</Kbd> orbit · <Kbd>+</Kbd> / <Kbd>-</Kbd> zoom · <Kbd>F</Kbd> fit
          </span>
        </div>
      )}
    </div>
  )
}

function ViewportReporter({ onChange }: { onChange: (info: ViewportInfo) => void }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: { target: THREE.Vector3 } | null }
  const last = useRef<string>('')
  useFrame(() => {
    const pos = camera.position
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    const azimuth = (Math.atan2(-dir.z, dir.x) * 180) / Math.PI
    const polar = (Math.acos(Math.min(1, Math.max(-1, dir.y))) * 180) / Math.PI
    const target = controls?.target ?? new THREE.Vector3()
    const distance = pos.distanceTo(target)
    const next: ViewportInfo = {
      cameraPos: [pos.x, pos.y, pos.z],
      distance,
      azimuth: Math.round(((azimuth % 360) + 360) % 360),
      polar: Math.round(polar),
    }
    const key = `${next.cameraPos.map((n) => n.toFixed(1)).join(',')}|${next.distance.toFixed(1)}|${next.azimuth}|${next.polar}`
    if (key !== last.current) {
      last.current = key
      onChange(next)
    }
  })
  return null
}

function CityBase({ width, depth }: { width: number; depth: number }) {
  // Dark plinth under the city — like the screenshot.
  return (
    <group>
      <mesh receiveShadow position={[width / 2, -0.6, depth / 2]}>
        <boxGeometry args={[width * 1.04, 1.2, depth * 1.04]} />
        <meshStandardMaterial color={GROUND_DARK} roughness={0.9} />
      </mesh>
    </group>
  )
}

interface BuildingsProps {
  layout: CityLayoutT
  focusedFileId: number | null
  connectedFileIds: Set<number>
  neighborWeight: Map<number, number>
  maxNeighborWeight: number
  citations: Map<number, number>
  hovered: number | null
  onHover: (id: number | null) => void
  onClick: (id: number | null) => void
  buildingColors: Map<number, string>
  shadowsOn: boolean
}

// The bulk of the city is drawn as ONE InstancedMesh (one draw call, one object)
// instead of a React component + mesh per file. Only "special" buildings —
// focused, its connected neighbours, and cited ones — are rendered individually,
// because they need per-building emissive glow, halos, and badges the instanced
// material can't express. There are only ever a handful of those.
function Buildings({
  layout,
  focusedFileId,
  connectedFileIds,
  neighborWeight,
  maxNeighborWeight,
  citations,
  hovered,
  onHover,
  onClick,
  buildingColors,
  shadowsOn,
}: BuildingsProps) {
  // Hover is excluded from the partition on purpose: it doesn't change a
  // building's appearance (only the cursor + a floating label), so letting it
  // flip buildings in/out of the instanced mesh would remount it on every hover.
  const specialIds = useMemo(() => {
    const s = new Set<number>()
    if (focusedFileId !== null) s.add(focusedFileId)
    for (const id of connectedFileIds) s.add(id)
    for (const id of citations.keys()) s.add(id)
    return s
  }, [focusedFileId, connectedFileIds, citations])

  const baseBuildings = useMemo(
    () => layout.buildings.filter((b) => !specialIds.has(b.file.id)),
    [layout.buildings, specialIds],
  )
  const specialBuildings = useMemo(
    () => layout.buildings.filter((b) => specialIds.has(b.file.id)),
    [layout.buildings, specialIds],
  )

  // Only the biggest base buildings get rooftop labels (troika text is the
  // heaviest per-building cost). Special buildings always render their own label.
  const labeledBase = useMemo(() => {
    if (baseBuildings.length <= CITY_LABEL_BUDGET) return baseBuildings
    return [...baseBuildings].sort((a, b) => b.file.loc - a.file.loc).slice(0, CITY_LABEL_BUDGET)
  }, [baseBuildings])

  return (
    <group>
      <InstancedBuildings
        buildings={baseBuildings}
        colors={buildingColors}
        dimmed={focusedFileId !== null}
        castShadow={shadowsOn}
        onHover={onHover}
        onClick={onClick}
      />
      <BuildingLabels buildings={labeledBase} colors={buildingColors} dimmed={focusedFileId !== null} />
      {specialBuildings.map((b) => {
        const isConnected = connectedFileIds.has(b.file.id)
        return (
          <Building
            key={b.file.id}
            building={b}
            color={buildingColors.get(b.file.id) ?? b.color}
            isFocused={focusedFileId === b.file.id}
            isConnected={isConnected}
            importance={isConnected ? (neighborWeight.get(b.file.id) ?? 0) / maxNeighborWeight : 0}
            isHovered={hovered === b.file.id}
            isDimmed={false}
            citationIndex={citations.get(b.file.id) ?? null}
            onHover={onHover}
            onClick={onClick}
            castShadow={shadowsOn}
          />
        )
      })}
    </group>
  )
}

// One InstancedMesh for every "plain" building. A unit box is scaled + placed per
// instance via its matrix, and tinted via instanceColor — so thousands of files
// cost one draw call. When anything is focused, the whole base dims uniformly
// (the focused file's neighbours are rendered individually and stay bright).
function InstancedBuildings({
  buildings,
  colors,
  dimmed,
  castShadow,
  onHover,
  onClick,
}: {
  buildings: BuildingT[]
  colors: Map<number, string>
  dimmed: boolean
  castShadow: boolean
  onHover: (id: number | null) => void
  onClick: (id: number | null) => void
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const count = buildings.length

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const col = new THREE.Color()
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]!
      pos.set(b.x + b.w / 2, b.h / 2, b.z + b.d / 2)
      scl.set(b.w, b.h, b.d)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
      col.set(colors.get(b.file.id) ?? b.color)
      mesh.setColorAt(i, col)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [buildings, colors])

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      // key on count so a changed instance count cleanly rebuilds the buffers.
      key={count}
      args={[undefined, undefined, count]}
      castShadow={castShadow}
      receiveShadow
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        const b = e.instanceId != null ? buildings[e.instanceId] : undefined
        if (b) {
          onHover(b.file.id)
          document.body.style.cursor = 'pointer'
        }
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onHover(null)
        document.body.style.cursor = 'auto'
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        const b = e.instanceId != null ? buildings[e.instanceId] : undefined
        if (b) onClick(b.file.id)
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial transparent={dimmed} opacity={dimmed ? 0.16 : 1} />
    </instancedMesh>
  )
}

// Rooftop labels for the (gated) set of base buildings. Kept out of the
// InstancedMesh because troika <Text> is its own geometry per label.
function BuildingLabels({
  buildings,
  colors,
  dimmed,
}: {
  buildings: BuildingT[]
  colors: Map<number, string>
  dimmed: boolean
}) {
  return (
    <group>
      {buildings.map((b) => (
        <BuildingLabel
          key={b.file.id}
          building={b}
          colorHex={colors.get(b.file.id) ?? b.color}
          dimmed={dimmed}
        />
      ))}
    </group>
  )
}

function BuildingLabel({ building, colorHex, dimmed }: { building: BuildingT; colorHex: string; dimmed: boolean }) {
  const contrast = useMemo(() => readableTextColor(colorHex), [colorHex])
  const plan = useMemo(() => planLabel(shortName(building.file.path), building.w), [building.file.path, building.w])
  return (
    <Text
      position={[building.x + building.w / 2, building.h + 0.02, building.z + building.d / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      fontSize={plan.fontSize}
      color={contrast.fg}
      outlineWidth={plan.fontSize * 0.04}
      outlineColor={contrast.outline}
      outlineOpacity={0.7}
      anchorX="center"
      anchorY="middle"
      maxWidth={building.w * 0.92}
      clipRect={[-building.w / 2 + 0.1, -building.d / 2 + 0.1, building.w / 2 - 0.1, building.d / 2 - 0.1]}
      fillOpacity={dimmed ? 0.18 : 1}
    >
      {plan.text}
    </Text>
  )
}

interface BuildingProps {
  building: BuildingT
  color: string
  isFocused: boolean
  isConnected: boolean
  importance?: number
  isHovered: boolean
  isDimmed: boolean
  citationIndex: number | null
  onHover: (id: number | null) => void
  onClick: (id: number | null) => void
  castShadow?: boolean
}

// Amber glow for connected neighbours (matches the graph view's --color-hot-2).
const CONNECTED_GLOW = 0xf59e0b

function Building({
  building,
  color: colorHex,
  isFocused,
  isConnected,
  importance = 0,
  isHovered,
  isDimmed,
  citationIndex,
  onHover,
  onClick,
  castShadow = true,
}: BuildingProps) {
  const color = useMemo(() => new THREE.Color(colorHex), [colorHex])
  const emissive = useMemo(
    () =>
      isFocused
        ? new THREE.Color(colorHex).multiplyScalar(0.55)
        : isConnected
          ? new THREE.Color(CONNECTED_GLOW)
          : new THREE.Color(0x000000),
    [isFocused, isConnected, colorHex],
  )
  // Connected neighbours glow amber, intensity scaled by import strength so the
  // most important ones read strongest. Unconnected fade hard (the 3D "blur").
  const emissiveIntensity = isFocused ? 0.45 : isConnected ? 0.3 + importance * 0.5 : 0
  const opacity = isDimmed ? 0.16 : 1
  // Pick a text + outline pair that stays readable against the rooftop color.
  const contrast = useMemo(() => readableTextColor(colorHex), [colorHex])
  // Plan the label so it always fits inside the rooftop footprint: pick a
  // fontSize that scales the name down to the building width, and only
  // truncate if even the minimum size would overflow.
  const plan = useMemo(
    () => planLabel(shortName(building.file.path), building.w),
    [building.file.path, building.w],
  )
  const labelOpacity = isDimmed ? 0.18 : 1

  return (
    <group>
      <mesh
        castShadow={castShadow}
        receiveShadow
        position={[building.x + building.w / 2, building.h / 2, building.z + building.d / 2]}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          onHover(building.file.id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          onHover(null)
          document.body.style.cursor = 'auto'
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onClick(building.file.id)
        }}
      >
        <boxGeometry args={[building.w, building.h, building.d]} />
        <meshLambertMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          transparent={isDimmed}
          opacity={opacity}
        />
      </mesh>

      {/* File name printed flat on the rooftop. */}
      <Text
        position={[
          building.x + building.w / 2,
          building.h + 0.02,
          building.z + building.d / 2,
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={plan.fontSize}
        color={contrast.fg}
        outlineWidth={plan.fontSize * 0.04}
        outlineColor={contrast.outline}
        outlineOpacity={0.7}
        anchorX="center"
        anchorY="middle"
        maxWidth={building.w * 0.92}
        clipRect={[
          -building.w / 2 + 0.1,
          -building.d / 2 + 0.1,
          building.w / 2 - 0.1,
          building.d / 2 - 0.1,
        ]}
        fillOpacity={labelOpacity}
      >
        {plan.text}
      </Text>

      {/* Connected halo — appears on neighbours of the focused file. */}
      {isConnected && !isFocused ? (
        <mesh
          position={[building.x + building.w / 2, building.h + 0.04, building.z + building.d / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[
            Math.max(building.w, building.d) * 0.62,
            Math.max(building.w, building.d) * 0.72,
            48,
          ]} />
          <meshBasicMaterial color="#0a0a0a" transparent opacity={0.55} />
        </mesh>
      ) : null}

      {citationIndex !== null ? (
        <Html
          position={[building.x + building.w / 2, building.h + 2, building.z + building.d / 2]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="grid size-5 place-items-center rounded-full bg-[color:var(--color-accent)] text-[10px] font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]">
            {citationIndex}
          </div>
        </Html>
      ) : null}
    </group>
  )
}

// WCAG-style relative luminance → pick ink-on-light or white-on-dark, plus a
// contrast outline color for legibility against the building's shading.
function readableTextColor(hex: string): { fg: string; outline: string } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return { fg: '#ffffff', outline: '#000000' }
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = toLinear(parseInt(m[1] ?? '0', 16))
  const g = toLinear(parseInt(m[2] ?? '0', 16))
  const b = toLinear(parseInt(m[3] ?? '0', 16))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.5
    ? { fg: '#0a0a0a', outline: '#ffffff' }
    : { fg: '#ffffff', outline: '#000000' }
}

// Plan a rooftop label that is guaranteed to fit inside the building's
// footprint. We scale the font down for long names first, and only
// truncate when even the minimum readable size would overflow.
const LABEL_MAX_FONT = 1.0
const LABEL_MIN_FONT = 0.5
// Approximate horizontal cost of a single character at fontSize=1.0
// for the default sans font drei/troika ships with.
const LABEL_CHAR_WIDTH = 0.6

function planLabel(name: string, blockWidth: number): { text: string; fontSize: number } {
  const target = blockWidth * 0.9
  // Step 1: pick the largest fontSize at which the full name fits.
  const ideal = target / Math.max(1, name.length * LABEL_CHAR_WIDTH)
  const fontSize = Math.max(LABEL_MIN_FONT, Math.min(LABEL_MAX_FONT, ideal))
  if (fontSize > LABEL_MIN_FONT) {
    return { text: name, fontSize }
  }
  // Step 2: font is at the minimum and the name is still too long — truncate
  // hard while preserving a short file extension when one exists.
  const maxChars = Math.max(3, Math.floor(target / (LABEL_CHAR_WIDTH * LABEL_MIN_FONT)))
  return { text: truncateName(name, maxChars), fontSize: LABEL_MIN_FONT }
}

function truncateName(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name
  const dot = name.lastIndexOf('.')
  if (dot > 0 && name.length - dot <= 5) {
    const ext = name.slice(dot)
    const stemBudget = maxChars - ext.length - 1
    if (stemBudget >= 3) return name.slice(0, stemBudget) + '…' + ext
  }
  return name.slice(0, Math.max(1, maxChars - 1)) + '…'
}

interface EdgeSegment {
  points: THREE.Vector3[]
  startpoint: THREE.Vector3
  endpoint: THREE.Vector3
  tangent: THREE.Vector3
  weight: number
  src: BuildingT
  dst: BuildingT
  highlighted: boolean
  dimmed: boolean
}

function Edges({
  layout,
  focusedFileId,
  edgeWeightByPair,
}: {
  layout: CityLayoutT
  focusedFileId: number | null
  edgeWeightByPair: Map<string, number>
}) {
  const segments = useMemo<EdgeSegment[]>(() => {
    // Bound how many arcs we build: when focused, only edges touching the focus;
    // otherwise the heaviest CITY_EDGE_CAP imports. Each arc is several meshes +
    // a per-frame dash animation, so an uncapped edge set is a real cost.
    let sourceEdges = layout.edges
    if (focusedFileId !== null) {
      sourceEdges = layout.edges.filter(
        (e) => e.source_id === focusedFileId || e.target_id === focusedFileId,
      )
    } else if (layout.edges.length > CITY_EDGE_CAP) {
      sourceEdges = [...layout.edges]
        .sort(
          (a, b) =>
            (edgeWeightByPair.get(`${b.source_id}->${b.target_id}`) ?? 1) -
            (edgeWeightByPair.get(`${a.source_id}->${a.target_id}`) ?? 1),
        )
        .slice(0, CITY_EDGE_CAP)
    }

    const out: EdgeSegment[] = []
    for (const e of sourceEdges) {
      const src = layout.buildingByFileId.get(e.source_id)
      const dst = layout.buildingByFileId.get(e.target_id)
      if (!src || !dst) continue
      const a = new THREE.Vector3(src.x + src.w / 2, src.h + 0.4, src.z + src.d / 2)
      const c = new THREE.Vector3(dst.x + dst.w / 2, dst.h + 0.4, dst.z + dst.d / 2)
      const mid = new THREE.Vector3()
        .addVectors(a, c)
        .multiplyScalar(0.5)
        .setY(Math.max(a.y, c.y) + a.distanceTo(c) * 0.32 + 3.5)
      const curve = new THREE.QuadraticBezierCurve3(a, mid, c)
      const points = curve.getPoints(36)
      // Stop the line a touch before the target so it doesn't clip into
      // the rooftop, and leave a clean landing for the arrow cone.
      const tip = curve.getPoint(0.94)
      const tangent = curve.getTangent(0.94).normalize()
      points[points.length - 1] = tip
      const highlighted =
        focusedFileId !== null && (e.source_id === focusedFileId || e.target_id === focusedFileId)
      const dimmed = focusedFileId !== null && !highlighted
      out.push({
        points,
        startpoint: a,
        endpoint: tip,
        tangent,
        weight: edgeWeightByPair.get(`${e.source_id}->${e.target_id}`) ?? 1,
        src,
        dst,
        highlighted,
        dimmed,
      })
    }
    return out
  }, [layout.edges, layout.buildingByFileId, focusedFileId, edgeWeightByPair])

  return (
    <group>
      {segments.map((s, i) => (
        <EdgeArc key={i} segment={s} />
      ))}
    </group>
  )
}

// Used to orient the arrow cone along the curve tangent.
const CONE_UP = new THREE.Vector3(0, 1, 0)

function EdgeArc({ segment }: { segment: EdgeSegment }) {
  const lineRef = useRef<Line2Impl | null>(null)
  const [hovered, setHovered] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  // Animate a dash flow along the curve to communicate direction. We do
  // it for every edge (subtle when idle, prominent when highlighted) so
  // the city always feels alive.
  useFrame((_, delta) => {
    const obj = lineRef.current
    const mat = obj?.material as { dashOffset?: number } | undefined
    if (!mat || mat.dashOffset === undefined) return
    mat.dashOffset -= delta * (segment.highlighted || hovered || tooltipOpen ? 5 : 1.2)
  })

  const active = segment.highlighted || hovered || tooltipOpen
  const color = active ? '#0a0a0a' : '#475569'
  const opacity = segment.dimmed && !hovered && !tooltipOpen ? 0.1 : active ? 1 : 0.6
  const lineWidth = active ? 3.6 : 1.8
  const markerSize = active ? 0.55 : 0.32
  const midpoint = useMemo(() => {
    const pts = segment.points
    return pts[Math.floor(pts.length / 2)] ?? segment.endpoint
  }, [segment.points, segment.endpoint])

  // Cone orientation: rotate the default +Y cone to face along the tangent.
  const coneQuat = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(CONE_UP, segment.tangent)
    return q
  }, [segment.tangent])

  return (
    <group
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={(e) => {
        e.stopPropagation()
        setHovered(false)
        document.body.style.cursor = 'auto'
      }}
      onClick={(e) => {
        e.stopPropagation()
        setTooltipOpen((v) => !v)
      }}
    >
      <Line
        ref={lineRef}
        points={segment.points}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={opacity}
        dashed
        dashScale={1}
        dashSize={0.9}
        gapSize={0.45}
      />

      {/* Endpoint markers — easy visual ID for which buildings an edge connects. */}
      <mesh position={segment.startpoint}>
        <sphereGeometry args={[markerSize, 14, 14]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={segment.endpoint} quaternion={coneQuat}>
        <coneGeometry args={[markerSize * 0.95, markerSize * 2.6, 12]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>

      {/* Tooltip — opens on click; hover only highlights the line. */}
      {tooltipOpen ? (
        <Html
          position={[midpoint.x, midpoint.y + 0.6, midpoint.z]}
          center
          style={{ pointerEvents: 'auto' }}
          zIndexRange={[40, 0]}
        >
          <div
            className="whitespace-nowrap rounded-md border border-black/15 bg-white px-2.5 py-1.5 text-[11px] text-black shadow-[0_6px_20px_rgba(0,0,0,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-semibold">{shortName(segment.src.file.path)}</span>
              <span className="text-black/40">→</span>
              <span className="font-mono font-semibold">{shortName(segment.dst.file.path)}</span>
              <button
                type="button"
                onClick={() => setTooltipOpen(false)}
                aria-label="Close"
                className="ml-1 grid size-4 place-items-center rounded text-black/45 hover:bg-black/5 hover:text-black"
              >
                ×
              </button>
            </div>
            <div className="mt-0.5 text-[10px] text-black/55">
              {segment.weight} import{segment.weight === 1 ? '' : 's'}
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  )
}

function FocusedLabel({
  building,
  degree,
  history,
}: {
  building: BuildingT | null
  degree?: { in: number; out: number }
  history?: FileHistory
}) {
  if (!building) return null
  const inC = degree?.in ?? 0
  const outC = degree?.out ?? 0
  const churn = history?.commits_90d ?? 0
  return (
    <Html
      position={[building.x + building.w / 2, building.h + 4, building.z + building.d / 2]}
      center
      style={{ pointerEvents: 'none' }}
      zIndexRange={[10, 0]}
    >
      <div className="relative -translate-y-1">
        <div className="absolute left-1/2 top-full h-3 w-px -translate-x-1/2 bg-black/30" />
        <div className="rounded-md bg-white px-3 py-1.5 text-center shadow-[0_4px_18px_rgba(0,0,0,0.18)]">
          <div className="text-[12px] font-semibold leading-tight text-black">
            {shortName(building.file.path)}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-black/55">
            {building.file.language} · {building.file.loc} LOC
          </div>
          <div className="mt-0.5 font-mono text-[9px] text-black/45">
            {inC} in · {outC} out · {churn} commits/90d
          </div>
        </div>
      </div>
    </Html>
  )
}

function HoverLabel({ building }: { building: BuildingT | null }) {
  if (!building) return null
  return (
    <Html
      position={[building.x + building.w / 2, building.h + 2.5, building.z + building.d / 2]}
      center
      style={{ pointerEvents: 'none' }}
      zIndexRange={[5, 0]}
    >
      <div className="whitespace-nowrap rounded bg-black/80 px-2 py-1 font-mono text-[10px] text-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]">
        {shortName(building.file.path)}
      </div>
    </Html>
  )
}

function ZoomSlider({
  pct,
  displayPct,
  onChange,
  onMinus,
  onPlus,
}: {
  pct: number
  displayPct: number
  onChange: (next: number) => void
  onMinus: () => void
  onPlus: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white/95 px-2 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,0.08)] backdrop-blur-sm">
      <button
        type="button"
        onClick={onMinus}
        title="Zoom out"
        className="grid size-5 place-items-center text-black/60 hover:text-black"
      >
        <Minus size={12} strokeWidth={2.2} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Zoom level"
        className="city-zoom-range h-1 w-[120px] cursor-pointer appearance-none bg-black/15 outline-none"
      />
      <button
        type="button"
        onClick={onPlus}
        title="Zoom in"
        className="grid size-5 place-items-center text-black/60 hover:text-black"
      >
        <Plus size={12} strokeWidth={2.2} />
      </button>
      <span className="font-mono text-[10px] tabular-nums text-black/70">{displayPct}%</span>
      <style>{`
        .city-zoom-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 12px; height: 12px; border-radius: 50%;
          background: var(--color-accent);
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          cursor: pointer;
        }
        .city-zoom-range::-moz-range-thumb {
          width: 12px; height: 12px; border-radius: 50%;
          background: var(--color-accent);
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}

function ViewportPill({ info }: { info: ViewportInfo }) {
  const compass = compassDir(info.azimuth)
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md border border-black/10 bg-white/95 px-3 py-2 font-mono text-[10px] text-black/75 shadow-[0_4px_14px_rgba(0,0,0,0.06)] backdrop-blur-sm">
      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-black/45">
        <span>viewport</span>
        <span className="font-mono text-black/70">{compass}</span>
      </div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-black/45">pos</span>
        <span className="text-right">
          {info.cameraPos.map((n) => n.toFixed(0)).join(' · ')}
        </span>
        <span className="text-black/45">azim</span>
        <span className="text-right">{info.azimuth}°</span>
        <span className="text-black/45">polar</span>
        <span className="text-right">{info.polar}°</span>
      </div>
    </div>
  )
}

function compassDir(azimuthDeg: number): string {
  const buckets = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE']
  const i = Math.round(((azimuthDeg % 360) / 45)) % 8
  return buckets[i] ?? 'E'
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded border border-black/15 bg-white/95 px-1 py-0.5 text-[10px] text-black/75 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
      {children}
    </span>
  )
}

function FocusedPill({ building, onClear }: { building: BuildingT; onClear: () => void }) {
  return (
    <div className="pointer-events-auto absolute bottom-12 left-1/2 z-10 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-black/10 bg-white/95 py-1.5 pl-3 pr-1.5 shadow-[0_4px_18px_rgba(0,0,0,0.12)] backdrop-blur-sm">
        <span
          aria-hidden
          className="inline-block size-2.5 rounded-full"
          style={{ background: building.color }}
        />
        <span className="text-[12px] font-semibold text-black">{shortName(building.file.path)}</span>
        <span className="font-mono text-[10px] text-black/55">
          {building.file.language} · {building.file.loc} LOC
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear focus"
          className="ml-1 grid size-6 place-items-center rounded-full bg-black/10 text-black/70 transition-colors hover:bg-black/20 hover:text-black"
        >
          ×
        </button>
      </div>
    </div>
  )
}

// Folder names rendered on the base, sitting at ground level on the front edge
// of each district. Always face the camera via Html (sprite mode).
function DistrictLabels({ districts }: { districts: CityLayoutT['districts'] }) {
  return (
    <group>
      {districts.map((d) => (
        <DistrictLabel key={d.folder} district={d} />
      ))}
    </group>
  )
}

function DistrictLabel({ district: d }: { district: CityLayoutT['districts'][number] }) {
  const [hovered, setHovered] = useState(false)
  return (
    <Html
      position={[d.x + d.w / 2, 0.08, d.z + d.d + 0.4]}
      center
      occlude={false}
      zIndexRange={[2, 0]}
    >
      <div
        className="whitespace-nowrap rounded-sm bg-[#1B1D22] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/95 shadow-[0_2px_6px_rgba(0,0,0,0.18)]"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {folderLabel(d.folder)} <span className="text-white/55">· {d.fileCount}</span>
      </div>
      {hovered ? (
        <div className="pointer-events-none absolute left-1/2 top-[calc(100%+4px)] -translate-x-1/2 whitespace-nowrap rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-[11px] text-black shadow-[0_6px_20px_rgba(0,0,0,0.12)]">
          <div className="font-mono font-semibold">{folderLabel(d.folder)}</div>
          <div className="mt-0.5 text-[10px] text-black/55">
            {d.fileCount} file{d.fileCount === 1 ? '' : 's'} · {d.totalLoc} LOC
          </div>
        </div>
      ) : null}
    </Html>
  )
}

function ColorModePicker({
  mode,
  onChange,
}: {
  mode: ColorMode
  onChange: (next: ColorMode) => void
}) {
  const [open, setOpen] = useState(false)
  const active = COLOR_MODES.find((m) => m.id === mode) ?? COLOR_MODES[0]
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Color encoding"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
          'border-black/15 bg-white text-black/80 hover:border-black/40 hover:text-black',
          open && 'border-black/40 text-black',
        )}
      >
        <Palette size={12} strokeWidth={2} />
        <span className="font-mono text-[11px]">{active?.label ?? 'Color'}</span>
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-20 w-[220px] rounded-md border border-black/10 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
        >
          {COLOR_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === mode}
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-start justify-between gap-2 px-3 py-2 text-left transition-colors',
                m.id === mode
                  ? 'bg-[color:color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[color:var(--color-accent)]'
                  : 'text-black/80 hover:bg-black/[0.04]',
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-[12px] font-medium leading-tight">{m.label}</span>
                <span className="font-mono text-[10px] text-black/55">{m.hint}</span>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/40">
                {m.kind}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ColorLegend({
  mode,
  graph,
  layout,
}: {
  mode: ColorMode
  graph: GraphResponse
  layout: CityLayoutT
}) {
  if (mode === 'language') {
    const counts = new Map<Language, number>()
    for (const f of graph.files) counts.set(f.language, (counts.get(f.language) ?? 0) + 1)
    const items = [...counts.entries()]
      .map(([lang, count]) => ({ key: lang, label: lang, color: languageColor(lang), count }))
      .sort((a, b) => b.count - a.count)
    return <LegendCategory title="languages" items={items} />
  }
  if (mode === 'file_type') {
    const counts = new Map<FileType, number>()
    for (const f of graph.files) {
      const t = fileType(f.path, f.language)
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const items = [...counts.entries()]
      .map(([t, count]) => ({ key: t, label: FILE_TYPE_LABELS[t], color: fileTypeColor(t), count }))
      .sort((a, b) => b.count - a.count)
    return <LegendCategory title="file types" items={items} />
  }
  const bands = metricLegend(mode, {
    maxLoc: layout.maxLoc,
    maxHotness: layout.maxHotness,
    historyByFile: layout.historyByFile,
  })
  if (!bands) return null
  return <LegendGradient title={mode === 'loc' ? 'LOC' : 'commits 30d'} bands={bands} />
}

function LegendCategory({
  title,
  items,
}: {
  title: string
  items: Array<{ key: string; label: string; color: string; count: number }>
}) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md border border-black/10 bg-white/95 px-3 py-2.5 shadow-[0_4px_18px_rgba(0,0,0,0.06)] backdrop-blur-sm">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-black/45">
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map(({ key, label, color, count }) => (
          <li key={key} className="flex items-center justify-between gap-3 text-[11px] text-black/85">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-sm"
                style={{ background: color }}
              />
              <span className="font-mono text-[11px]">{label}</span>
            </span>
            <span className="font-mono text-[10px] text-black/45">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Keyboard nav for the 3D city. Arrows pan in screen space; shift+arrows
// orbit around the focal point; +/- dolly in/out; 0 or F resets the camera.
function useCityKeyboard(
  active: boolean,
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>,
) {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const ctrl = controlsRef.current
      if (!ctrl) return
      const cam = ctrl.object as THREE.PerspectiveCamera
      const target = ctrl.target

      const rotateStep = (Math.PI / 180) * (e.shiftKey ? 10 : 6)
      const panStep = e.shiftKey ? 22 : 10
      const dollyStep = 0.85

      const offset = new THREE.Vector3().subVectors(cam.position, target)

      switch (e.key) {
        case '+':
        case '=':
          offset.multiplyScalar(dollyStep)
          cam.position.copy(target).add(offset)
          ctrl.update()
          e.preventDefault()
          break
        case '-':
        case '_':
          offset.divideScalar(dollyStep)
          cam.position.copy(target).add(offset)
          ctrl.update()
          e.preventDefault()
          break
        case '0':
        case 'f':
        case 'F':
          ctrl.reset?.()
          e.preventDefault()
          break
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (e.shiftKey) {
            // Orbit. Horizontal arrows rotate around world Y; vertical arrows
            // tilt around the camera's right axis (clamped via OrbitControls).
            const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
            const sign = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 1 : -1
            const quat = new THREE.Quaternion()
            if (horizontal) {
              quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sign * rotateStep)
            } else {
              const right = new THREE.Vector3().crossVectors(cam.up, offset).normalize()
              quat.setFromAxisAngle(right, sign * rotateStep)
            }
            offset.applyQuaternion(quat)
            cam.position.copy(target).add(offset)
            cam.lookAt(target)
          } else {
            // Pan — translate camera and target together in screen space.
            const forward = new THREE.Vector3().subVectors(target, cam.position).normalize()
            const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize()
            const up = new THREE.Vector3().crossVectors(right, forward).normalize()
            let dx = 0
            let dy = 0
            if (e.key === 'ArrowLeft') dx = -panStep
            if (e.key === 'ArrowRight') dx = panStep
            if (e.key === 'ArrowUp') dy = panStep
            if (e.key === 'ArrowDown') dy = -panStep
            const shift = new THREE.Vector3()
              .addScaledVector(right, dx)
              .addScaledVector(up, dy)
            cam.position.add(shift)
            target.add(shift)
          }
          ctrl.update()
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, controlsRef])
}

function LegendGradient({ title, bands }: { title: string; bands: LegendBand[] }) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-10 w-[220px] rounded-md border border-black/10 bg-white/95 px-3 py-2.5 shadow-[0_4px_18px_rgba(0,0,0,0.06)] backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-black/45">
        <span>{title}</span>
        <span className="text-black/35">reserved scale</span>
      </div>
      <div
        aria-hidden
        className="h-2 w-full rounded-sm"
        style={{
          background: `linear-gradient(to right, ${bands.map((b) => b.color).join(', ')})`,
        }}
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-black/55">
        {bands.map((b, i) => (
          <span key={i}>{b.label}</span>
        ))}
      </div>
    </div>
  )
}
