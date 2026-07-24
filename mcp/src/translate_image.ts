import * as fs from 'node:fs'
import sharp from 'sharp'

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

function colorName(r: number, g: number, b: number): string {
  const h = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * (180 / Math.PI)
  const hNorm = h < 0 ? h + 360 : h
  const smax = Math.max(r, g, b)
  const smin = Math.min(r, g, b)
  const s = smax === 0 ? 0 : (smax - smin) / smax
  const v = smax / 255

  if (v < 0.15) return 'black'
  if (v > 0.92 && s < 0.08) return 'white'
  if (s < 0.1) return 'grey'

  if (hNorm < 20 || hNorm >= 340) return 'red'
  if (hNorm < 50) return 'orange'
  if (hNorm < 70) return 'yellow'
  if (hNorm < 160) return 'green'
  if (hNorm < 210) return 'teal'
  if (hNorm < 280) return 'blue'
  if (hNorm < 330) return 'purple'
  return 'red'
}

interface Bucket {
  r: number
  g: number
  b: number
  count: number
}

function dominantColors(data: Buffer, pixelCount: number): string {
  const buckets = new Map<string, Bucket>()
  const step = Math.max(1, Math.floor(pixelCount / 4000))
  for (let i = 0; i < pixelCount; i += step) {
    const ri = i * 3
    const r = data[ri]!
    const g = data[ri + 1]!
    const b = data[ri + 2]!
    const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`
    const existing = buckets.get(key)
    if (existing) {
      existing.count++
    } else {
      buckets.set(key, { r, g, b, count: 1 })
    }
  }

  const sorted = [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)

  const total = sorted.reduce((s, [, v]) => s + v.count, 0)
  return sorted.map(([, v]) => {
    const pct = ((v.count / total) * 100).toFixed(0)
    return `  ${rgbToHex(v.r, v.g, v.b)} (${colorName(v.r, v.g, v.b)}, ${pct}%)`
  }).join('\n')
}

interface LumHist {
  mean: number
  std: number
  darkPct: number
  midPct: number
  brightPct: number
}

function luminanceHistogram(luma: number[], count: number): LumHist {
  let sum = 0
  let sumSq = 0
  let dark = 0
  let mid = 0
  let bright = 0
  for (let i = 0; i < count; i++) {
    const v = luma[i]!
    sum += v
    sumSq += v * v
    if (v < 64) dark++
    else if (v < 192) mid++
    else bright++
  }
  const mean = sum / count
  const variance = sumSq / count - mean * mean
  return {
    mean: Math.round(mean),
    std: Math.round(Math.sqrt(variance)),
    darkPct: +((dark / count) * 100).toFixed(1),
    midPct: +((mid / count) * 100).toFixed(1),
    brightPct: +((bright / count) * 100).toFixed(1),
  }
}

function blurMetric(luma: number[], w: number, h: number): number {
  if (w < 3 || h < 3) return 0
  let sum = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = luma[i]! * 4 - luma[i - 1]! - luma[i + 1]! - luma[i - w]! - luma[i + w]!
      sum += lap * lap
      count++
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0
}

function edgeDensity(luma: number[], w: number, h: number): number {
  if (w < 3 || h < 3) return 0
  let edgePixels = 0
  let total = 0
  const threshold = 60

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = -luma[i - w - 1]! + luma[i - w + 1]! - 2 * luma[i - 1]! + 2 * luma[i + 1]! - luma[i + w - 1]! + luma[i + w + 1]!
      const gy = -luma[i - w - 1]! - 2 * luma[i - w]! - luma[i - w + 1]! + luma[i + w - 1]! + 2 * luma[i + w]! + luma[i + w + 1]!
      const mag = Math.sqrt(gx * gx + gy * gy)
      if (mag > threshold) edgePixels++
      total++
    }
  }
  return total > 0 ? +((edgePixels / total) * 100).toFixed(1) : 0
}

function textRegionEstimate(luma: number[], w: number, h: number): number {
  const blockSize = 32
  const cols = Math.floor(w / blockSize)
  const rows = Math.floor(h / blockSize)
  let textBlocks = 0
  let totalBlocks = 0

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let min = 255
      let max = 0
      for (let y = 0; y < blockSize; y++) {
        for (let x = 0; x < blockSize; x++) {
          const idx = (row * blockSize + y) * w + (col * blockSize + x)
      const v = luma[idx]!
          if (v < min) min = v
          if (v > max) max = v
        }
      }
      if (max - min > 80) textBlocks++
      totalBlocks++
    }
  }
  return totalBlocks > 0 ? Math.round((textBlocks / totalBlocks) * 100) : 0
}

function layoutDescription(luma: number[], w: number, h: number): string {
  const hw = Math.floor(w / 2)
  const hh = Math.floor(h / 2)
  const quads = [0, 0, 0, 0]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = luma[y * w + x]!
      const q = (y < hh ? 0 : 2) + (x < hw ? 0 : 1)
      quads[q]! += v
    }
  }

  const area = hw * hh
  const means = quads.map((s) => s / area)
  const range = Math.max(...means) - Math.min(...means)

  const top = (means[0]! + means[1]!) / 2
  const bot = (means[2]! + means[3]!) / 2
  const left = (means[0]! + means[2]!) / 2
  const right = (means[1]! + means[3]!) / 2

  const parts: string[] = []
  if (range < 15) parts.push('uniform luminance')
  else parts.push('varied luminance')

  if (Math.abs(top - bot) > 25) parts.push(top > bot ? 'top-heavy' : 'bottom-heavy')
  if (Math.abs(left - right) > 25) parts.push(left > right ? 'left-heavy' : 'right-heavy')

  return parts.join(', ') || 'balanced layout'
}

export async function describeImage(imagePath: string): Promise<{ description: string; format: string }> {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`)
  }

  const metadata = await sharp(imagePath).metadata()
  const ow = metadata.width!
  const oh = metadata.height!
  const fmt = metadata.format || 'unknown'

  const scale = Math.min(1, 800 / Math.max(ow, oh))
  const w = Math.round(ow * scale)
  const h = Math.round(oh * scale)

  const { data } = await sharp(imagePath)
    .resize(w, h, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixelCount = data.length / 3
  const luma: number[] = new Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const ri = i * 3
    luma[i] = Math.round(0.299 * data[ri]! + 0.587 * data[ri + 1]! + 0.114 * data[ri + 2]!)
  }

  const colors = dominantColors(data, pixelCount)
  const hist = luminanceHistogram(luma, pixelCount)
  const blur = blurMetric(luma, w, h)
  const edges = edgeDensity(luma, w, h)
  const textPct = textRegionEstimate(luma, w, h)
  const layout = layoutDescription(luma, w, h)

  const saturatedPct = hist.brightPct > 20 ? +(hist.brightPct - 20).toFixed(1) : 0
  const exposureLabel = saturatedPct > 10 ? 'overexposed' : hist.darkPct > 40 ? 'underexposed' : hist.mean > 160 ? 'bright' : hist.mean < 80 ? 'dark' : 'well-exposed'

  const ar = (ow / oh).toFixed(2)
  const arLabel = parseFloat(ar) > 1.4 ? 'landscape' : parseFloat(ar) < 0.7 ? 'portrait' : 'square-ish'
  const blurLabel = blur < 8 ? 'sharp' : blur < 20 ? 'slightly soft' : 'blurry'
  const complexityLabel = edges < 3 ? 'minimal (sparse layout)' : edges < 10 ? 'moderate (typical UI)' : 'complex (dense content)'

  const description = [
    `Image: ${ow}×${oh} ${fmt}, ${arLabel} (${ar})`,
    '',
    `Dimensions: ${ow}×${oh}`,
    `Format: ${fmt}`,
    `Aspect ratio: ${ar} (${arLabel})`,
    '',
    'Dominant colors:',
    colors,
    '',
    'Luminance:',
    `  Mean: ${hist.mean}/255`,
    `  Std dev: ${hist.std}`,
    `  Distribution: ${hist.darkPct}% dark · ${hist.midPct}% mid · ${hist.brightPct}% bright`,
    `  Exposure: ${exposureLabel}`,
    saturatedPct > 0 ? `  Approx saturated area: ${saturatedPct}%` : null,
    '',
    `Sharpness: ${blurLabel} (Laplacian variance=${blur.toFixed(1)})`,
    `Edge density: ${edges}% — ${complexityLabel}`,
    `Text-like regions: ~${textPct}% of blocks`,
    `Layout: ${layout}`,
  ]
    .filter((x): x is string => x !== null)
    .join('\n')

  return { description, format: fmt }
}
