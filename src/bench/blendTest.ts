// G0.1: every blend mode and adjustment table on the GPU, checked pixel by pixel against the CPU reference.

import { adjustmentTable, type AdjustmentTable } from '../engine/adjustments'
import { compositePixel } from '../engine/blendMath'
import { CanvasRenderer } from '../engine/canvasRenderer'
import { Compositor, type PixelSource } from '../engine/compositor'
import { BLEND_MODES, CURRENT_VERSION, FORMAT, fullCanvasTransform, type Adjustment, type BlendMode, type LayerRecord } from '../model/manifest'
import { warmCurves } from './synthetic'

const SIZE = 64
/** Largest difference, in 8-bit steps, still counted as a match. */
export const TOLERANCE = 2

export interface TestRow {
  name: string
  maxError: number
  /** Channels differing by more than `TOLERANCE`. */
  over: number
  channels: number
  pass: boolean
}

/** Colors that include the values blend formulas branch on (0, ½, 1) and plenty in between. */
const SPECIAL = [0, 1, 63, 64, 127, 128, 191, 254, 255]
function sample(seed: number) {
  const h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  return h % 3 === 0 ? SPECIAL[h % SPECIAL.length] : (h >>> 8) % 256
}

/** Premultiplied RGBA bytes: opaque over most of the square, partly transparent along one side (`alphaAxis`). */
function testImage(salt: number, alphaAxis: 'x' | 'y'): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      const t = alphaAxis === 'x' ? x : y
      const alpha = t < 44 ? 255 : (t * 37 + salt) % 256
      for (let c = 0; c < 3; c++) data[i + c] = Math.round((sample(i * 7 + c * 131 + salt) * alpha) / 255)
      data[i + 3] = alpha
    }
  return data
}

function doc(layers: LayerRecord[]) {
  return {
    format: FORMAT, version: CURRENT_VERSION, colorSpace: 'sRGB', documentID: 'TEST', width: SIZE, height: SIZE, layers,
  }
}

function layer(id: string, extra: Partial<LayerRecord>): LayerRecord {
  return { id, name: id, isVisible: true, transform: fullCanvasTransform(SIZE, SIZE), ...extra }
}

function compare(name: string, gpu: Uint8Array, cpu: (i: number) => number[]): TestRow {
  let maxError = 0, over = 0, channels = 0
  for (let p = 0; p < SIZE * SIZE; p++) {
    const expected = cpu(p)
    for (let c = 0; c < 4; c++) {
      const e = Math.abs(gpu[p * 4 + c] - Math.round(expected[c] * 255))
      maxError = Math.max(maxError, e)
      if (e > TOLERANCE) over++
      channels++
    }
  }
  return { name, maxError, over, channels, pass: over === 0 }
}

/** What a channel table or cube does to one unpremultiplied color, as `levels_apply` and `cube_apply` do upstream. */
function applyTable(table: AdjustmentTable, rgb: number[]): number[] {
  if (table.kind === 'channels') {
    return rgb.map((v, c) => {
      const x = Math.min(255, v * 255), lo = Math.floor(x), hi = Math.min(255, lo + 1)
      const a = table.rgb[lo * 4 + c], b = table.rgb[hi * 4 + c]
      return a + (b - a) * (x - lo)
    })
  }
  const n = table.size, s = n - 1
  const pos = rgb.map((v) => Math.min(s, v * s))
  const lo = pos.map(Math.floor), hi = lo.map((l) => Math.min(s, l + 1)), f = pos.map((p, i) => p - lo[i])
  const at = (r: number, g: number, b: number, c: number) => table.data[((b * n + g) * n + r) * 4 + c]
  return [0, 1, 2].map((c) => {
    let out = 0
    for (const [br, wr] of [[lo[0], 1 - f[0]], [hi[0], f[0]]])
      for (const [bg, wg] of [[lo[1], 1 - f[1]], [hi[1], f[1]]])
        for (const [bb, wb] of [[lo[2], 1 - f[2]], [hi[2], f[2]]]) out += at(br, bg, bb, c) * wr * wg * wb
    return out
  })
}

export function runBlendTests(): TestRow[] {
  const compositor = new Compositor(new OffscreenCanvas(SIZE, SIZE))
  const backdrop = testImage(3, 'y'), source = testImage(11, 'x')
  const assets = new Map<string, PixelSource>([
    ['B.png', { width: SIZE, height: SIZE, data: backdrop }],
    ['S.png', { width: SIZE, height: SIZE, data: source }],
  ])
  const store = { get: (f: string) => assets.get(f) }
  const view = { scale: 1, x: 0, y: 0 }
  const opacity = 0.8
  const px = (data: Uint8Array, p: number) => [0, 1, 2, 3].map((c) => data[p * 4 + c] / 255) as [number, number, number, number]
  const rows: TestRow[] = []

  for (const mode of BLEND_MODES) {
    const d = doc([layer('B', { imageFile: 'B.png' }), layer('S', { imageFile: 'S.png', blendMode: mode as BlendMode, opacity })])
    const gpu = compositor.read(compositor.composite(d, store, SIZE, SIZE, view, 'test'))
    rows.push(compare(mode, gpu, (p) => compositePixel(mode, px(backdrop, p), px(source, p), opacity)))
  }

  const adjustments: [string, Adjustment][] = [
    ['Curves', warmCurves()],
    ['Levels', { kind: 'Levels', levels: { channel: 'RGB', ranges: [
      { black: 20, gamma: 1.4, white: 230, outputBlack: 10, outputWhite: 250 },
      { black: 0, gamma: 0.8, white: 255, outputBlack: 0, outputWhite: 255 },
      { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 },
      { black: 30, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 }] } }],
    ['Exposure', { kind: 'Exposure', exposureSettings: { exposure: 0.7, offset: 0.02, gamma: 1.1 } }],
    ['Hue/Saturation', { kind: 'Hue/Saturation', hue: 40, saturation: 35, lightness: -10, colorize: false }],
    ['Hue/Saturation (Colorize)', { kind: 'Hue/Saturation', hue: 200, saturation: 50, lightness: 5, colorize: true }],
  ]
  for (const [name, adjustment] of adjustments) {
    const table = adjustmentTable(adjustment)!
    const d = doc([layer('B', { imageFile: 'B.png' }), layer('A', { adjustment, opacity })])
    const gpu = compositor.read(compositor.composite(d, store, SIZE, SIZE, view, 'test'))
    rows.push(compare(`Adjust: ${name}`, gpu, (p) => {
      const b = px(backdrop, p)
      if (b[3] === 0) return b
      const rgb = [b[0] / b[3], b[1] / b[3], b[2] / b[3]]
      const adjusted = applyTable(table, rgb)
      return [0, 1, 2].map((c) => (rgb[c] + (Math.min(1, Math.max(0, adjusted[c])) - rgb[c]) * opacity) * b[3]).concat(b[3])
    }))
  }
  // A cube made after an image went up the ordinary way (ImageBitmap, premultiplied on upload): the upload must leave
  // the pixel-store state as it found it, or WebGL2 refuses the cube and the adjustment turns everything black.
  {
    const canvas = new OffscreenCanvas(SIZE, SIZE)
    const g = canvas.getContext('2d')!
    g.fillStyle = 'rgb(200, 90, 40)'
    g.fillRect(0, 0, SIZE, SIZE)
    const bitmap = canvas.transferToImageBitmap()
    const withBitmap = new Map<string, PixelSource>([['P.png', bitmap]])
    const adjustment: Adjustment = { kind: 'Hue/Saturation', hue: 20, saturation: 40, lightness: 0, colorize: false }
    const d = doc([layer('P', { imageFile: 'P.png' }), layer('A', { adjustment })])
    const gpu = compositor.read(compositor.composite(d, { get: (f) => withBitmap.get(f) }, SIZE, SIZE, view, 'test'))
    const table = adjustmentTable(adjustment)!
    const expected = applyTable(table, [200 / 255, 90 / 255, 40 / 255])
    rows.push(compare('Adjust after image upload', gpu, () => [...expected.map((v) => Math.min(1, Math.max(0, v))), 1]))
    bitmap.close()
  }
  compositor.releaseSurfaces('test')
  return [...rows, ...orientationTests()]
}

/** Red on top, blue below, drawn onto a canvas by each path the canvas uses; the top must stay on top. */
function orientationTests(): TestRow[] {
  const compositor = new Compositor(new OffscreenCanvas(SIZE, SIZE))
  const renderer = new CanvasRenderer(compositor)
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) data.set(y < SIZE / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * SIZE + x) * 4)
  const assets = new Map<string, PixelSource>([['T.png', { width: SIZE, height: SIZE, data }]])
  const store = { get: (f: string) => assets.get(f) }
  const d = doc([layer('T', { imageFile: 'T.png' })])
  const gl = compositor.gl
  const rows: TestRow[] = []
  for (const expected of ['screen', 'cache-build', 'cache']) {
    const path = renderer.frame(d, store, SIZE, SIZE, { scale: 1, x: 0, y: 0 })
    const pixels = new Uint8Array(SIZE * SIZE * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels) // Bottom row first.
    const top = pixels.slice((SIZE - 5) * SIZE * 4, (SIZE - 5) * SIZE * 4 + 3)
    const bottom = pixels.slice(4 * SIZE * 4, 4 * SIZE * 4 + 3)
    const ok = path === expected && top[0] > 200 && top[2] < 50 && bottom[2] > 200 && bottom[0] < 50
    rows.push({ name: `Orientation: ${expected}`, maxError: ok ? 0 : 255, over: ok ? 0 : 1, channels: 1, pass: ok })
  }
  return rows
}
