// Color adjustments as lookup tables, ported from upstream Document/Levels.swift, Curves.swift, ImageAdjustments.swift
// and HueSaturation.swift. Everything that changes each color on its own becomes a table; the GPU then needs one
// shader for all of them (upstream's GPU canvas does the same with Core Image cubes).

import type { Adjustment, CurvePoint, ExposureSettings, LevelRange } from '../model/manifest'

/** Per-channel 256-entry tables (red, green, blue), on unpremultiplied values 0–1. */
export interface ChannelTables {
  kind: 'channels'
  rgb: Float32Array // 256 × 4 (RGBA, A unused), ready to upload as a 256×1 texture
}
/** A `CUBE`³ color cube, red fastest, RGBA. */
export interface ColorCube {
  kind: 'cube'
  size: number
  data: Float32Array
}
export type AdjustmentTable = ChannelTables | ColorCube

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// MARK: Levels

const IDENTITY_RANGE: LevelRange = { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 }

function normalizedRange(r: LevelRange): LevelRange {
  const fin = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? clamp(n, lo, hi) : fallback)
  const black = fin(r.black, 0, 254, 0)
  return {
    black,
    white: fin(r.white, black + 1, 255, 255),
    gamma: fin(r.gamma, 0.1, 9.99, 1),
    outputBlack: fin(r.outputBlack, 0, 255, 0),
    outputWhite: fin(r.outputWhite, 0, 255, 255),
  }
}

export function levelValue(range: LevelRange, value: number): number {
  const s = normalizedRange(range)
  const input = clamp((value * 255 - s.black) / (s.white - s.black), 0, 1)
  return (s.outputBlack + Math.pow(input, 1 / s.gamma) * (s.outputWhite - s.outputBlack)) / 255
}

/** Individual channels first, then the composite RGB range. */
export function levelsTables(ranges: LevelRange[] | undefined): ChannelTables {
  const r = [0, 1, 2, 3].map((i) => ranges?.[i] ?? IDENTITY_RANGE)
  return channelTables((v, c) => levelValue(r[0], levelValue(r[c + 1], v)))
}

// MARK: Curves

/** Shape-preserving cubic Hermite interpolation, 0–255 in and out. */
export function curveValue(points: CurvePoint[], x: number): number {
  const p = points
  let i = 0
  for (let j = 0; j < p.length; j++) if (p[j].x <= x) i = j
  i = Math.min(p.length - 2, Math.max(0, i))
  const d = p.slice(1).map((q, j) => (q.y - p[j].y) / (q.x - p[j].x))
  const slope = (j: number) => {
    if (j === 0) return d[0]
    if (j === p.length - 1) return d[d.length - 1]
    if (d[j - 1] * d[j] <= 0) return 0
    return 2 / (1 / d[j - 1] + 1 / d[j])
  }
  const h = p[i + 1].x - p[i].x
  const t = clamp((x - p[i].x) / h, 0, 1)
  const y =
    (2 * t ** 3 - 3 * t ** 2 + 1) * p[i].y +
    (t ** 3 - 2 * t ** 2 + t) * h * slope(i) +
    (-2 * t ** 3 + 3 * t ** 2) * p[i + 1].y +
    (t ** 3 - t ** 2) * h * slope(i + 1)
  return clamp(y, 0, 255)
}

const IDENTITY_CURVE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }]

/** Each channel's curve, then the RGB curve. */
export function curvesTables(channels: CurvePoint[][] | undefined): ChannelTables {
  const c = [0, 1, 2, 3].map((i) => (channels?.[i]?.length ?? 0) >= 2 ? channels![i] : IDENTITY_CURVE)
  return channelTables((v, ch) => curveValue(c[0], curveValue(c[ch + 1], v * 255)) / 255)
}

// MARK: Exposure

export function exposureTables(s: ExposureSettings | undefined): ChannelTables {
  const exposure = clamp(s?.exposure ?? 0, -20, 20)
  const offset = clamp(s?.offset ?? 0, -0.5, 0.5)
  const gamma = clamp(s?.gamma ?? 1, 0.01, 9.99)
  const scale = Math.pow(2, exposure)
  return channelTables((encoded) => {
    let linear = encoded <= 0.04045 ? encoded / 12.92 : Math.pow((encoded + 0.055) / 1.055, 2.4)
    linear = Math.pow(Math.max(0, linear * scale + offset), 1 / gamma)
    const out = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055
    return clamp(out, 0, 1)
  })
}

export function invertTables(): ChannelTables {
  return channelTables((v) => 1 - v)
}

function channelTables(f: (value: number, channel: number) => number): ChannelTables {
  const rgb = new Float32Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    for (let c = 0; c < 3; c++) rgb[i * 4 + c] = f(i / 255, c)
    rgb[i * 4 + 3] = 1
  }
  return { kind: 'channels', rgb }
}

// MARK: Hue/Saturation

interface RangeAdjustment {
  hue: number
  saturation: number
  lightness: number
}
interface HueBand {
  falloffStart: number
  rangeStart: number
  rangeEnd: number
  falloffEnd: number
}
const DEFAULT_BANDS: Record<string, HueBand> = {
  Master: { falloffStart: 0, rangeStart: 0, rangeEnd: 360, falloffEnd: 360 },
  Reds: { falloffStart: 315, rangeStart: 345, rangeEnd: 15, falloffEnd: 45 },
  Yellows: { falloffStart: 15, rangeStart: 45, rangeEnd: 75, falloffEnd: 105 },
  Greens: { falloffStart: 75, rangeStart: 105, rangeEnd: 135, falloffEnd: 165 },
  Cyans: { falloffStart: 135, rangeStart: 165, rangeEnd: 195, falloffEnd: 225 },
  Blues: { falloffStart: 195, rangeStart: 225, rangeEnd: 255, falloffEnd: 285 },
  Magentas: { falloffStart: 255, rangeStart: 285, rangeEnd: 315, falloffEnd: 345 },
}

/** Swift encodes an enum-keyed dictionary either as an object or as a flat [key, value, key, value] array. */
function swiftDictionary<T>(raw: unknown): Record<string, T> {
  if (Array.isArray(raw)) {
    const out: Record<string, T> = {}
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = raw[i + 1] as T
    return out
  }
  return (raw ?? {}) as Record<string, T>
}

const forward = (from: number, to: number) => {
  const delta = (to - from) % 360
  return delta < 0 ? delta + 360 : delta
}

function bandWeight(b: HueBand, hue: number): number {
  const span = forward(b.falloffStart, b.falloffEnd)
  if (span <= 0) return 1
  const position = forward(b.falloffStart, hue)
  if (position > span) return 0
  const rampIn = forward(b.falloffStart, b.rangeStart)
  const plateauEnd = forward(b.falloffStart, b.rangeEnd)
  if (position < rampIn) return rampIn > 0 ? position / rampIn : 1
  if (position <= plateauEnd) return 1
  const rampOut = span - plateauEnd
  return rampOut > 0 ? (span - position) / rampOut : 1
}

function toHSL(r: number, g: number, b: number): [number, number, number] {
  const high = Math.max(r, g, b), low = Math.min(r, g, b)
  const l = (high + low) / 2
  const delta = high - low
  if (delta <= 0) return [0, 0, l]
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return [h, Math.min(1, s), l]
}

function toRGB(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) return [l, l, l]
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const sector = h / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const base = l - chroma / 2
  const table: [number, number, number][] = [
    [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
    [0, second, chroma], [second, 0, chroma], [chroma, 0, second],
  ]
  const [r, g, b] = table[Math.min(5, Math.max(0, Math.trunc(sector)))]
  return [clamp(r + base, 0, 1), clamp(g + base, 0, 1), clamp(b + base, 0, 1)]
}

function adjustedSaturation(s: number, amount: number): number {
  const a = clamp(amount / 100, -1, 1)
  if (a <= 0) return Math.max(0, s * (1 + a))
  return a >= 1 ? (s > 0 ? 1 : 0) : Math.min(1, s / (1 - a))
}

export const CUBE_SIZE = 33

export function hueSaturationCube(adj: Adjustment): ColorCube {
  const settings = adj.hsvSettings as
    | { colorize?: boolean; adjustments?: unknown; bands?: unknown; range?: string }
    | undefined
  const colorize = settings?.colorize ?? adj.colorize ?? false
  const adjustments = settings
    ? swiftDictionary<RangeAdjustment>(settings.adjustments)
    : { Master: { hue: adj.hue ?? 0, saturation: adj.saturation ?? 0, lightness: adj.lightness ?? 0 } }
  const bands = { ...DEFAULT_BANDS, ...swiftDictionary<HueBand>(settings?.bands) }
  // Colorize reads the selected range's sliders (Master unless the file says otherwise).
  const selected = adjustments[settings?.range ?? 'Master'] ?? { hue: 0, saturation: 0, lightness: 0 }

  const response = Array.from({ length: 361 }, (_, degree) => {
    const out = { shift: 0, saturation: 0, lightness: 0 }
    for (const [range, a] of Object.entries(adjustments)) {
      const w = range === 'Master' ? 1 : bandWeight(bands[range] ?? DEFAULT_BANDS.Master, degree)
      if (w <= 0) continue
      out.shift += (a.hue ?? 0) * w
      out.saturation += (a.saturation ?? 0) * w
      out.lightness += (a.lightness ?? 0) * w
    }
    return out
  })

  const n = CUBE_SIZE, step = n - 1
  const data = new Float32Array(n * n * n * 4)
  let i = 0
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        let [h, s, l] = toHSL(r / step, g / step, b / step)
        let lightness: number
        if (colorize) {
          h = selected.hue % 360
          s = clamp(selected.saturation / 100, 0, 1)
          lightness = selected.lightness / 100
        } else {
          const sampled = response[clamp(Math.round(h), 0, 360)]
          lightness = sampled.lightness / 100
          h = (h + sampled.shift) % 360
          if (h < 0) h += 360
          s = adjustedSaturation(s, sampled.saturation)
        }
        const amount = clamp(lightness, -1, 1)
        l = amount >= 0 ? l + (1 - l) * amount : l * (1 + amount)
        const [or, og, ob] = toRGB(h, s, clamp(l, 0, 1))
        data[i++] = or
        data[i++] = og
        data[i++] = ob
        data[i++] = 1
      }
  return { kind: 'cube', size: n, data }
}

/** The table for an adjustment, or null for kinds the web engine doesn't draw yet (they pass the backdrop through). */
export function adjustmentTable(adj: Adjustment): AdjustmentTable | null {
  switch (adj.kind) {
    case 'Levels': return levelsTables(adj.levels?.ranges)
    case 'Curves': return curvesTables(adj.curves?.channels)
    case 'Exposure': return exposureTables(adj.exposureSettings)
    case 'Invert': return invertTables()
    case 'Hue/Saturation': return hueSaturationCube(adj)
    default: return null
  }
}
