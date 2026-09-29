// Photoshop's blend modes on the CPU: the reference the GPU shaders are tested against (`?test=blend`).
// Separable modes follow the W3C Compositing spec (as Core Graphics does upstream), plus Photoshop's extra modes.
// Blending happens on sRGB values, not linear light, as it does in the desktop app and in Photoshop.

import type { BlendMode } from '../model/manifest'

type RGB = [number, number, number]

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function colorDodge(b: number, s: number) {
  if (b <= 0) return 0
  if (s >= 1) return 1
  return Math.min(1, b / (1 - s))
}
function colorBurn(b: number, s: number) {
  if (b >= 1) return 1
  if (s <= 0) return 0
  return 1 - Math.min(1, (1 - b) / s)
}
const screen = (b: number, s: number) => b + s - b * s
const hardLight = (b: number, s: number) => (s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1))
function softLight(b: number, s: number) {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b)
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
  return b + (2 * s - 1) * (d - b)
}

const SEPARABLE: Partial<Record<BlendMode, (b: number, s: number) => number>> = {
  Normal: (_b, s) => s,
  Darken: Math.min,
  Multiply: (b, s) => b * s,
  'Color Burn': colorBurn,
  'Linear Burn': (b, s) => Math.max(0, b + s - 1),
  Lighten: Math.max,
  Screen: screen,
  'Color Dodge': colorDodge,
  'Linear Dodge (Add)': (b, s) => Math.min(1, b + s),
  Overlay: (b, s) => hardLight(s, b),
  'Soft Light': softLight,
  'Hard Light': hardLight,
  'Vivid Light': (b, s) => (s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1)),
  'Linear Light': (b, s) => clamp01(b + 2 * s - 1),
  'Pin Light': (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  'Hard Mix': (b, s) => (b + s >= 1 ? 1 : 0),
  Difference: (b, s) => Math.abs(b - s),
  Exclusion: (b, s) => b + s - 2 * b * s,
  Subtract: (b, s) => Math.max(0, b - s),
  Divide: (b, s) => (b <= 0 ? 0 : s <= 0 ? 1 : Math.min(1, b / s)),
}

const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
function clipColor(c: RGB): RGB {
  const l = lum(c), n = Math.min(...c), x = Math.max(...c)
  let out = c
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB
  return out
}
function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c)
  return clipColor([c[0] + d, c[1] + d, c[2] + d])
}
const sat = (c: RGB) => Math.max(...c) - Math.min(...c)
function setSat(c: RGB, s: number): RGB {
  const mx = Math.max(...c), mn = Math.min(...c)
  if (mx <= mn) return [0, 0, 0]
  return c.map((v) => ((v - mn) * s) / (mx - mn)) as RGB
}

export function blendColor(mode: BlendMode, cb: RGB, cs: RGB): RGB {
  const f = SEPARABLE[mode]
  if (f) return [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])]
  switch (mode) {
    case 'Hue': return setLum(setSat(cs, sat(cb)), lum(cb))
    case 'Saturation': return setLum(setSat(cb, sat(cs)), lum(cb))
    case 'Color': return setLum(cs, lum(cb))
    default: return setLum(cb, lum(cs)) // Luminosity
  }
}

/**
 * One layer composited over the backdrop. Both are premultiplied RGBA, 0–1; `coverage` is opacity times masks.
 * Where the backdrop is transparent the layer shows as itself, and elsewhere as the blend (W3C: Cs' = (1−αb)·Cs + αb·B).
 */
export function compositePixel(
  mode: BlendMode, backdrop: [number, number, number, number], source: [number, number, number, number], coverage: number,
): [number, number, number, number] {
  const ab = backdrop[3], as0 = source[3]
  const Cb: RGB = ab > 0 ? [backdrop[0] / ab, backdrop[1] / ab, backdrop[2] / ab] : [0, 0, 0]
  const Cs: RGB = as0 > 0 ? [source[0] / as0, source[1] / as0, source[2] / as0] : [0, 0, 0]
  const B = blendColor(mode, Cb, Cs)
  const as = as0 * coverage
  const mixed = [0, 1, 2].map((i) => (1 - ab) * Cs[i] + ab * clamp01(B[i]))
  return [
    as * mixed[0] + (1 - as) * backdrop[0],
    as * mixed[1] + (1 - as) * backdrop[1],
    as * mixed[2] + (1 - as) * backdrop[2],
    as + ab * (1 - as),
  ]
}
