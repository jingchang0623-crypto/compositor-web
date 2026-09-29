import { describe, expect, it } from 'vitest'
import { bounds, combine, contains, invert, selectAll, trace } from './selection'

describe('selection', () => {
  const rect = { kind: 'rect' as const, op: 'add' as const, x: 10, y: 10, w: 20, h: 10 }
  it('adds, subtracts and inverts in order', () => {
    let s = combine(null, rect)
    s = combine(s, { ...rect, op: 'subtract', x: 20, w: 5 })
    expect(contains(s, 12, 12)).toBe(true)
    expect(contains(s, 22, 12)).toBe(false)
    expect(contains(invert(s), 22, 12)).toBe(true)
    expect(contains(invert(s), 12, 12)).toBe(false)
  })
  it('bounds the added shapes, clipped to the canvas', () => {
    expect(bounds(combine(null, { ...rect, x: -5 }), 100, 100)).toEqual({ x: 0, y: 10, w: 15, h: 10 })
    expect(bounds(selectAll(40, 30), 40, 30)).toEqual({ x: 0, y: 0, w: 40, h: 30 })
  })
  it('traces a mask into closed outlines at its corners', () => {
    // Two separate squares: two loops of four corners each.
    const w = 6, h = 3
    const mask = new Uint8Array(w * h)
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [4, 1], [5, 1], [4, 2], [5, 2]]) mask[y * w + x] = 255
    const loops = trace(mask, w, h)
    expect(loops).toHaveLength(2)
    expect(loops.every((l) => l.length === 8)).toBe(true)
  })
})
