import { describe, expect, it } from 'vitest'
import { fitView, formatZoom, keyboardZoomTarget, zoomTo } from './viewport'

describe('viewport', () => {
  it('fits with 48 points around the document, in device pixels, as upstream does', () => {
    // A 2000×1000 view at dpr 2 is 1000×500 points; less 96 is 904×404; a 1200×800 document fits by height.
    const v = fitView(2000, 1000, 2, { width: 1200, height: 800 })
    expect(v.scale).toBeCloseTo((404 / 800) * 2)
    expect(v.x + (1200 * v.scale) / 2).toBeCloseTo(1000) // Centered.
    expect(v.y + (800 * v.scale) / 2).toBeCloseTo(500)
  })

  it('keeps the point under the pointer still while zooming', () => {
    const v = { scale: 0.5, x: 100, y: 50 }
    const anchor = { x: 300, y: 200 }
    const docPoint = { x: (anchor.x - v.x) / v.scale, y: (anchor.y - v.y) / v.scale }
    const z = zoomTo(v, 2, anchor.x, anchor.y)
    expect(docPoint.x * z.scale + z.x).toBeCloseTo(anchor.x)
    expect(docPoint.y * z.scale + z.y).toBeCloseTo(anchor.y)
  })

  it('steps through the keyboard levels and stops at the ends', () => {
    expect(keyboardZoomTarget(1.46, 1)).toBe(1.5)
    expect(keyboardZoomTarget(1.46, -1)).toBe(1.25)
    expect(keyboardZoomTarget(1, 1)).toBe(1.25)
    expect(keyboardZoomTarget(16, 1)).toBe(16)
    expect(keyboardZoomTarget(0.125, -1)).toBe(0.125)
  })

  it('formats zoom as the status bar shows it', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(1.4632)).toBe('146.3%')
    expect(formatZoom(0.0512)).toBe('5.12%')
  })
})
