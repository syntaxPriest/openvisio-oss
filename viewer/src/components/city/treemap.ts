// Squarified treemap (Bruls, Huijsen, van Wijk 2000) — packs weighted items
// into a rectangle while keeping aspect ratios close to 1. This is what
// CodeCharta uses to lay out files inside folder bounding boxes.

export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

interface Item<K> {
  id: K
  value: number
}

export function squarifiedTreemap<K>(items: Item<K>[], bbox: Rect): Map<K, Rect> {
  const out = new Map<K, Rect>()
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
  if (sorted.length === 0 || bbox.w <= 0 || bbox.d <= 0) return out

  const totalValue = sorted.reduce((s, i) => s + i.value, 0)
  const scale = (bbox.w * bbox.d) / totalValue
  const scaled = sorted.map((i) => ({ id: i.id, value: i.value * scale }))

  squarify(scaled, [], bbox, out)
  return out
}

function squarify<K>(items: Item<K>[], row: Item<K>[], container: Rect, out: Map<K, Rect>) {
  while (items.length > 0) {
    const w = Math.min(container.w, container.d)
    if (w === 0) {
      if (row.length > 0) container = layoutRow(row, container, out)
      row = []
      break
    }
    const head = items[0]
    if (head === undefined) break
    const candidate = [...row, head]
    if (row.length === 0 || worstAspect(candidate, w) <= worstAspect(row, w)) {
      row = candidate
      items = items.slice(1)
    } else {
      container = layoutRow(row, container, out)
      row = []
    }
  }
  if (row.length > 0) layoutRow(row, container, out)
}

function worstAspect<K>(row: Item<K>[], w: number): number {
  let sum = 0
  let rmax = -Infinity
  let rmin = Infinity
  for (const r of row) {
    sum += r.value
    if (r.value > rmax) rmax = r.value
    if (r.value < rmin) rmin = r.value
  }
  if (sum === 0 || w === 0) return Infinity
  return Math.max((w * w * rmax) / (sum * sum), (sum * sum) / (w * w * rmin))
}

function layoutRow<K>(row: Item<K>[], container: Rect, out: Map<K, Rect>): Rect {
  const sum = row.reduce((a, b) => a + b.value, 0)
  const horizontal = container.w >= container.d
  if (horizontal) {
    const rowHeight = sum / container.w
    let cursor = container.x
    for (const item of row) {
      const itemW = item.value / rowHeight
      out.set(item.id, { x: cursor, z: container.z, w: itemW, d: rowHeight })
      cursor += itemW
    }
    return {
      x: container.x,
      z: container.z + rowHeight,
      w: container.w,
      d: container.d - rowHeight,
    }
  } else {
    const rowWidth = sum / container.d
    let cursor = container.z
    for (const item of row) {
      const itemD = item.value / rowWidth
      out.set(item.id, { x: container.x, z: cursor, w: rowWidth, d: itemD })
      cursor += itemD
    }
    return {
      x: container.x + rowWidth,
      z: container.z,
      w: container.w - rowWidth,
      d: container.d,
    }
  }
}
