'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { GraphResponse } from '@/lib/api/types'
import {
  ATLAS_LINK_COLOR,
  ATLAS_NODE_COLOR,
  buildAtlas,
  type AtlasData,
  type AtlasLinkKind,
  type AtlasNode,
  type AtlasNodeType,
} from '@/lib/graph/atlas'

export interface AtlasViewProps {
  graph: GraphResponse
  focusedFileId: number | null
  onFocus: (fileId: number | null) => void
  active?: boolean
  /** Hide chrome (the legend) when used as a decorative/hero backdrop. */
  embed?: boolean
}

const NODE_TYPES: AtlasNodeType[] = ['file', 'function', 'class', 'interface', 'type', 'const']
const LINK_KINDS: AtlasLinkKind[] = ['imports', 'defines', 'calls']
const NODE_LABEL: Record<AtlasNodeType, string> = {
  file: 'File',
  function: 'Function',
  class: 'Class',
  interface: 'Interface',
  type: 'Type',
  const: 'Const',
}

const BG = '#06070b'

// Soft additive glow point sprite — gives the galaxy bloom in one draw call,
// no postprocessing pass needed.
const NODE_VERT = `
  attribute float size;
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * uScale / max(1.0, -mv.z), 1.5, 64.0);
    gl_Position = projectionMatrix * mv;
  }
`
const NODE_FRAG = `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c) * 2.0;            // 0 center .. 1 edge
    float core = smoothstep(0.55, 0.0, d);
    float halo = smoothstep(1.0, 0.0, d);
    float a = clamp(core + halo * 0.35, 0.0, 1.0);
    if (a <= 0.001) discard;
    vec3 col = vColor * (0.55 + core * 0.9) + vec3(core * core * 0.5);
    gl_FragColor = vec4(col, a);
  }
`

interface Bounds {
  cx: number
  cy: number
  cz: number
  dist: number
  pickThreshold: number
}

function toColor(hex: string, boost: number): [number, number, number] {
  const c = new THREE.Color(hex)
  return [c.r * boost, c.g * boost, c.b * boost]
}

export function AtlasView({ graph, focusedFileId, onFocus, active = true, embed = false }: AtlasViewProps) {
  const atlas = useMemo(() => buildAtlas(graph), [graph])
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [hiddenTypes, setHiddenTypes] = useState<Set<AtlasNodeType>>(new Set())
  const [hiddenLinks, setHiddenLinks] = useState<Set<AtlasLinkKind>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)

  const bounds = useMemo<Bounds>(() => {
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const n of atlas.nodes) {
      if (n.x < minX) minX = n.x
      if (n.y < minY) minY = n.y
      if (n.z < minZ) minZ = n.z
      if (n.x > maxX) maxX = n.x
      if (n.y > maxY) maxY = n.y
      if (n.z > maxZ) maxZ = n.z
    }
    if (!Number.isFinite(minX)) return { cx: 0, cy: 0, cz: 0, dist: 1000, pickThreshold: 6 }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 50)
    return { cx, cy, cz, dist: extent * 1.2, pickThreshold: Math.max(5, extent / 180) }
  }, [atlas])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden" style={{ background: BG }}>
      <Canvas
        frameloop={active ? 'always' : 'never'}
        dpr={[1, 2]}
        camera={{
          position: [bounds.cx, bounds.cy - bounds.dist * 0.3, bounds.cz + bounds.dist * 0.92],
          fov: 45,
          near: 0.1,
          far: bounds.dist * 12,
        }}
        gl={{ toneMapping: THREE.NoToneMapping, antialias: true }}
        onPointerMissed={() => onFocus(null)}
      >
        <color attach="background" args={[BG]} />
        <AtlasScene
          atlas={atlas}
          bounds={bounds}
          hiddenTypes={hiddenTypes}
          hiddenLinks={hiddenLinks}
          focusedFileId={focusedFileId}
          onFocus={onFocus}
          onHover={(node, e) => {
            if (!node) {
              setHover(null)
              return
            }
            const rect = wrapRef.current?.getBoundingClientRect()
            setHover({
              x: (e.nativeEvent.clientX ?? 0) - (rect?.left ?? 0),
              y: (e.nativeEvent.clientY ?? 0) - (rect?.top ?? 0),
              text: node.label,
            })
          }}
        />
        {/* A true 3D galaxy: orbit to rotate, right-drag to pan, scroll to zoom. */}
        <OrbitControls
          makeDefault
          target={[bounds.cx, bounds.cy, bounds.cz]}
          enableDamping
          dampingFactor={0.12}
          enableRotate
          rotateSpeed={0.6}
          enablePan
          screenSpacePanning
          minDistance={bounds.dist * 0.04}
          maxDistance={bounds.dist * 6}
          zoomSpeed={1.2}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      </Canvas>

      {hover ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] truncate rounded bg-black/85 px-2 py-1 font-mono text-[10px] text-white"
          style={{ left: hover.x + 10, top: hover.y + 10 }}
        >
          {hover.text}
        </div>
      ) : null}

      {embed ? null : (
        <AtlasLegend
          nodeCounts={atlas.nodeCounts}
          linkCounts={atlas.linkCounts}
          truncated={atlas.truncated}
          totals={atlas.totals}
          hiddenTypes={hiddenTypes}
          hiddenLinks={hiddenLinks}
          onToggleType={(t) =>
            setHiddenTypes((prev) => {
              const next = new Set(prev)
              next.has(t) ? next.delete(t) : next.add(t)
              return next
            })
          }
          onToggleLink={(k) =>
            setHiddenLinks((prev) => {
              const next = new Set(prev)
              next.has(k) ? next.delete(k) : next.add(k)
              return next
            })
          }
        />
      )}
    </div>
  )
}

interface SceneProps {
  atlas: AtlasData
  bounds: Bounds
  hiddenTypes: Set<AtlasNodeType>
  hiddenLinks: Set<AtlasLinkKind>
  focusedFileId: number | null
  onFocus: (fileId: number | null) => void
  onHover: (node: AtlasNode | null, e: ThreeEvent<PointerEvent>) => void
}

function AtlasScene({ atlas, bounds, hiddenTypes, hiddenLinks, focusedFileId, onFocus, onHover }: SceneProps) {
  const { invalidate } = useThree()

  // Picking radius for the Points cloud (world units), scaled to the layout.
  const raycaster = useThree((s) => s.raycaster)
  useEffect(() => {
    raycaster.params.Points = { threshold: bounds.pickThreshold }
  }, [raycaster, bounds.pickThreshold])

  // ---- nodes: one THREE.Points (position + per-point color + size) ----
  const nodeData = useMemo(() => {
    const visible = atlas.nodes.filter((n) => !hiddenTypes.has(n.type))
    const count = visible.length
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const n = visible[i]!
      positions[i * 3] = n.x
      positions[i * 3 + 1] = n.y
      positions[i * 3 + 2] = n.z
      const [r, g, b] = toColor(ATLAS_NODE_COLOR[n.type], n.type === 'file' ? 1.5 : 1.25)
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
      sizes[i] = n.radius * 1.1
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geom.computeBoundingSphere()
    return { geom, index: visible }
  }, [atlas, hiddenTypes])

  const nodeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uScale: { value: bounds.dist * 1.3 } },
        vertexShader: NODE_VERT,
        fragmentShader: NODE_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    [bounds.dist],
  )

  // ---- edges: one THREE.LineSegments (2 verts/edge, per-vertex color) ----
  const edgeGeom = useMemo(() => {
    const posById = new Map<string, AtlasNode>()
    for (const n of atlas.nodes) posById.set(n.id, n)
    const kept: { s: AtlasNode; t: AtlasNode; kind: AtlasLinkKind }[] = []
    for (const l of atlas.links) {
      if (hiddenLinks.has(l.kind)) continue
      const s = posById.get(l.source)
      const t = posById.get(l.target)
      if (!s || !t || hiddenTypes.has(s.type) || hiddenTypes.has(t.type)) continue
      kept.push({ s, t, kind: l.kind })
    }
    const positions = new Float32Array(kept.length * 6)
    const colors = new Float32Array(kept.length * 6)
    for (let i = 0; i < kept.length; i++) {
      const { s, t, kind } = kept[i]!
      const intensity = kind === 'imports' ? 0.5 : kind === 'calls' ? 0.6 : 0.18
      const [r, g, b] = toColor(ATLAS_LINK_COLOR[kind], intensity)
      const o = i * 6
      positions[o] = s.x
      positions[o + 1] = s.y
      positions[o + 2] = s.z
      positions[o + 3] = t.x
      positions[o + 4] = t.y
      positions[o + 5] = t.z
      colors[o] = r
      colors[o + 1] = g
      colors[o + 2] = b
      colors[o + 3] = r
      colors[o + 4] = g
      colors[o + 5] = b
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geom
  }, [atlas, hiddenLinks, hiddenTypes])

  const edgeMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )

  // Dispose GPU resources when geometry/material is replaced.
  useEffect(() => () => nodeData.geom.dispose(), [nodeData])
  useEffect(() => () => nodeMaterial.dispose(), [nodeMaterial])
  useEffect(() => () => edgeGeom.dispose(), [edgeGeom])
  useEffect(() => () => edgeMaterial.dispose(), [edgeMaterial])

  // Frame the graph whenever it changes.
  const cameraRef = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    cameraRef.position.set(bounds.cx, bounds.cy - bounds.dist * 0.3, bounds.cz + bounds.dist * 0.92)
    cameraRef.far = bounds.dist * 12
    cameraRef.updateProjectionMatrix()
    if (controls) {
      controls.target.set(bounds.cx, bounds.cy, bounds.cz)
      controls.update()
    } else {
      cameraRef.lookAt(bounds.cx, bounds.cy, bounds.cz)
    }
    invalidate()
  }, [bounds, cameraRef, controls, invalidate])

  // Focused file node position (for the ring overlay).
  const focusPos = useMemo(() => {
    if (focusedFileId == null) return null
    const n = atlas.nodes.find((nd) => nd.type === 'file' && nd.fileId === focusedFileId)
    return n ? ([n.x, n.y, n.z] as [number, number, number]) : null
  }, [atlas, focusedFileId])

  const lastHover = useRef<number>(-1)

  return (
    <group>
      <lineSegments geometry={edgeGeom} material={edgeMaterial} frustumCulled={false} />
      <points
        geometry={nodeData.geom}
        material={nodeMaterial}
        frustumCulled={false}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          const idx = e.index ?? -1
          if (idx === lastHover.current) return
          lastHover.current = idx
          onHover(idx >= 0 ? nodeData.index[idx] ?? null : null, e)
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          lastHover.current = -1
          onHover(null, e)
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          const idx = e.index ?? -1
          const node = idx >= 0 ? nodeData.index[idx] : undefined
          if (node) onFocus(node.fileId)
        }}
      />
      {focusPos ? (
        <mesh position={focusPos}>
          <ringGeometry args={[bounds.pickThreshold * 1.1, bounds.pickThreshold * 1.5, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} />
        </mesh>
      ) : null}
    </group>
  )
}

function AtlasLegend({
  nodeCounts,
  linkCounts,
  truncated,
  totals,
  hiddenTypes,
  hiddenLinks,
  onToggleType,
  onToggleLink,
}: {
  nodeCounts: Record<AtlasNodeType, number>
  linkCounts: Record<AtlasLinkKind, number>
  truncated: boolean
  totals: { files: number; symbols: number }
  hiddenTypes: Set<AtlasNodeType>
  hiddenLinks: Set<AtlasLinkKind>
  onToggleType: (t: AtlasNodeType) => void
  onToggleLink: (k: AtlasLinkKind) => void
}) {
  const shownNodes = NODE_TYPES.reduce((sum, t) => sum + nodeCounts[t], 0)
  return (
    <div className="absolute left-4 top-4 z-10 w-[208px] rounded-lg border border-white/10 bg-black/55 p-3 backdrop-blur-sm">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">Nodes</div>
      <div className="flex flex-col gap-1">
        {NODE_TYPES.map((t) => {
          const off = hiddenTypes.has(t)
          return (
            <button
              key={t}
              type="button"
              onClick={() => onToggleType(t)}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-left transition-opacity hover:bg-white/5"
              style={{ opacity: off ? 0.4 : 1 }}
            >
              <span className="size-2 rounded-full" style={{ background: ATLAS_NODE_COLOR[t] }} />
              <span className="flex-1 text-[11px] text-white/85">{NODE_LABEL[t]}</span>
              <span className="font-mono text-[10px] text-white/45">{nodeCounts[t]}</span>
            </button>
          )
        })}
      </div>
      <div className="mb-1.5 mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">Edges</div>
      <div className="flex flex-col gap-1">
        {LINK_KINDS.filter((k) => linkCounts[k] > 0).map((k) => {
          const off = hiddenLinks.has(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => onToggleLink(k)}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-left transition-opacity hover:bg-white/5"
              style={{ opacity: off ? 0.4 : 1 }}
            >
              <span className="h-0.5 w-3 rounded-full" style={{ background: ATLAS_LINK_COLOR[k] }} />
              <span className="flex-1 text-[11px] capitalize text-white/85">{k}</span>
              <span className="font-mono text-[10px] text-white/45">{linkCounts[k]}</span>
            </button>
          )
        })}
      </div>
      {truncated ? (
        <div className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-snug text-amber-300/80">
          Showing {shownNodes.toLocaleString()} of {(totals.files + totals.symbols).toLocaleString()} nodes — the
          most connected. Capped to keep rendering smooth.
        </div>
      ) : null}
    </div>
  )
}
