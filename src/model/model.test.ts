import { describe, expect, it } from 'vitest'
import { curveValue, levelValue, levelsTables } from '../engine/adjustments'
import { compositePixel } from '../engine/blendMath'
import { fullCanvasTransform, parseManifest, type LayerRecord } from './manifest'
import { invert3, renderList, unitToDocument } from './renderList'

const layer = (id: string, extra: Partial<LayerRecord> = {}): LayerRecord => ({
  id, name: id, isVisible: true, transform: fullCanvasTransform(100, 100), ...extra,
})
const manifest = (layers: LayerRecord[]) => ({
  format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: 'D', width: 100, height: 100, layers,
})

describe('parseManifest', () => {
  it('accepts a minimal project and fills defaults', () => {
    const m = parseManifest(manifest([layer('A', { imageFile: 'A.png' })]))
    expect(m.resolution).toBe(72)
    expect(m.layers[0].transform.sampling).toBe('High quality')
  })
  it('refuses what the desktop app refuses', () => {
    expect(() => parseManifest({ ...manifest([]), version: 12 })).toThrow(/version/)
    expect(() => parseManifest(manifest([layer('A', { imageFile: 'B.png' })]))).toThrow(/A.png/)
    expect(() => parseManifest(manifest([layer('A', { blendMode: 'Plus' as never })]))).toThrow(/blend mode/)
    expect(() => parseManifest(manifest([layer('A', { parentID: 'B' }), layer('B')]))).toThrow(/not a folder/)
    expect(() => parseManifest(manifest([layer('A'), layer('A')]))).toThrow(/duplicate/)
  })
})

describe('renderList', () => {
  it('draws a folder’s subtree where the folder sits, with its opacity folded in', () => {
    const doc = parseManifest(manifest([
      layer('F', { isGroup: true, opacity: 0.5 }),
      layer('Top', { imageFile: 'Top.png' }),
      layer('Child', { imageFile: 'Child.png', parentID: 'F', opacity: 0.5 }),
    ]))
    const steps = renderList(doc)
    expect(steps.map((s) => s.layer.id)).toEqual(['Child', 'Top'])
    expect(steps[0].opacity).toBeCloseTo(0.25)
  })
  it('hides everything inside a hidden folder', () => {
    const doc = parseManifest(manifest([
      layer('F', { isGroup: true, isVisible: false }),
      layer('Child', { imageFile: 'Child.png', parentID: 'F' }),
    ]))
    expect(renderList(doc)).toEqual([])
  })
})

describe('transforms', () => {
  it('rotates clockwise about the center, as upstream LayerTransform.point does', () => {
    const m = unitToDocument({ origin: [0, 0], size: [100, 50], rotation: 90, flipX: false, flipY: false, sampling: 'Smooth' })
    const at = (u: number, v: number) => [m[0] * u + m[3] * v + m[6], m[1] * u + m[4] * v + m[7]]
    // The top-left corner of a 100×50 box centered at (50, 25), turned 90° clockwise (y down).
    const [x, y] = at(0, 0)
    expect(x).toBeCloseTo(75)
    expect(y).toBeCloseTo(-25)
    const inv = invert3(m)
    expect(inv[0] * x + inv[3] * y + inv[6]).toBeCloseTo(0)
  })
})

describe('adjustments', () => {
  it('levels match upstream LevelRange.apply', () => {
    const r = { black: 20, gamma: 1.4, white: 230, outputBlack: 10, outputWhite: 250 }
    expect(levelValue(r, 20 / 255)).toBeCloseTo(10 / 255)
    expect(levelValue(r, 1)).toBeCloseTo(250 / 255)
    expect(levelsTables(undefined).rgb[128 * 4]).toBeCloseTo(128 / 255)
  })
  it('curves pass through their points without overshoot', () => {
    const points = [{ x: 0, y: 0 }, { x: 120, y: 147 }, { x: 255, y: 255 }]
    expect(curveValue(points, 120)).toBeCloseTo(147)
    for (let x = 0; x <= 255; x += 5) expect(curveValue(points, x)).toBeLessThanOrEqual(255)
  })
})

describe('blending', () => {
  it('shows the layer as itself over a transparent backdrop, whatever the mode', () => {
    const out = compositePixel('Multiply', [0, 0, 0, 0], [0.5, 0.25, 0.1, 0.5], 1)
    expect(out.map((v) => +v.toFixed(4))).toEqual([0.5, 0.25, 0.1, 0.5])
  })
})
