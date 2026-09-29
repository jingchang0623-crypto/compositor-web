import { describe, expect, it } from 'vitest'
import type { LayerTransform } from './manifest'
import { bounds, corners, resized, rotated, snap, snapTargets, toDocument, toLocal } from './transform'

const T = (x: number, y: number, w: number, h: number, rotation = 0): LayerTransform =>
  ({ origin: [x, y], size: [w, h], rotation, flipX: false, flipY: false, sampling: 'High quality' })
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]))

describe('transform', () => {
  it('turns clockwise about the center', () => {
    const [tl] = corners(T(0, 0, 100, 50, 90))
    close([tl.x, tl.y], [75, -25])
    const p = { x: 12, y: 34 }, t = T(5, 5, 40, 20, 33)
    const back = toDocument(t, toLocal(t, p))
    close([back.x, back.y], [p.x, p.y])
  })
  it('resizes against the opposite side', () => {
    // Dragging the right edge from x=100 to x=150 widens by 50, left side fixed.
    const r = resized(T(0, 0, 100, 50), 1, 0, { x: 150, y: 25 }, true, false)
    close([...r.origin, ...r.size], [0, 0, 150, 50])
    // The bottom-right corner, proportions kept: the larger change wins.
    const c = resized(T(0, 0, 100, 50), 1, 1, { x: 200, y: 60 }, true, false)
    close([...c.origin, ...c.size], [0, 0, 200, 100])
    // From the center, both sides move.
    const m = resized(T(0, 0, 100, 50), 1, 0, { x: 110, y: 25 }, false, true)
    close([...m.origin, ...m.size], [-10, 0, 120, 50])
  })
  it('keeps the fixed side of a turned box in place', () => {
    const t = T(0, 0, 100, 50, 30)
    const leftMid = toDocument(t, { x: -50, y: 0 })
    const r = resized(t, 1, 0, toDocument(t, { x: 90, y: 0 }), false, false)
    const leftAfter = toDocument(r, { x: -r.size[0] / 2, y: 0 })
    close([leftAfter.x, leftAfter.y], [leftMid.x, leftMid.y])
    expect(r.size[0]).toBeCloseTo(140)
  })
  it('bounds a turned box and wraps angles', () => {
    const b = bounds(T(0, 0, 100, 100, 45))
    expect(b.x1 - b.x0).toBeCloseTo(100 * Math.SQRT2)
    expect(rotated(T(0, 0, 1, 1), 270).rotation).toBe(-90)
  })
  it('snaps the nearest edge or center within the threshold', () => {
    const { xs, ys } = snapTargets(1000, 800, [{ x0: 300, y0: 0, x1: 400, y1: 100 }])
    const s = snap({ x0: 396, y0: 395, x1: 496, y1: 405 }, xs, ys, 6)
    expect(s.dx).toBe(4) // Left edge 396 → the other layer's right edge 400.
    expect(s.dy).toBe(0) // Middle 400 → canvas center 400.
    expect(s.guides.map((g) => `${g.axis}${g.at}`).sort()).toEqual(['x400', 'y400'])
  })
})
