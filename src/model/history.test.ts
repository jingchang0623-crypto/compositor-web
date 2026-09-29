import { describe, expect, it } from 'vitest'
import { RasterSource, TILE } from '../engine/raster'
import { History, type DocState } from './history'
import { fullCanvasTransform, type Manifest } from './manifest'

const doc = (name: string): Manifest => ({
  format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: 'D', width: 10, height: 10,
  layers: [{ id: 'A', name, isVisible: true, transform: fullCanvasTransform(10, 10) }],
})
const state = (name: string, assets = new Map()): DocState => ({ doc: doc(name), assets })

describe('History', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    const h = new History(state('a'))
    h.commit('rename', state('b'))
    h.commit('rename', state('c'))
    expect(h.undo()?.doc.layers[0].name).toBe('b')
    expect(h.redo()?.doc.layers[0].name).toBe('c')
    h.undo()
    h.commit('rename', state('d'))
    expect(h.canRedo).toBe(false)
    expect(h.depth).toBe(2)
  })
  it('folds a gesture into one step until sealed', () => {
    const h = new History(state('a'))
    h.commit('opacity', state('b'), 'opacity:A')
    h.commit('opacity', state('c'), 'opacity:A')
    expect(h.depth).toBe(1)
    h.seal()
    h.commit('opacity', state('d'), 'opacity:A')
    expect(h.depth).toBe(2)
    expect(h.undo()?.doc.layers[0].name).toBe('c')
    expect(h.undo()?.doc.layers[0].name).toBe('a')
  })
  it('keeps at most its entry limit', () => {
    const h = new History(state('0'), 3)
    for (let i = 1; i <= 5; i++) h.commit('step', state(String(i)))
    expect(h.depth).toBe(3)
  })
  it('drops old steps past its byte budget, counting shared tiles once', () => {
    const big = RasterSource.fromPixels(TILE * 2, TILE, 4, new Uint8Array(TILE * 2 * TILE * 4).fill(9))
    const tileBytes = TILE * TILE * 4
    const h = new History(state('0', new Map([['A.png', big]])), 100, tileBytes * 2.5)
    let current = big
    for (let i = 1; i <= 4; i++) {
      // Each step repaints the first tile only; the second is shared by every state.
      current = current.withRegion(0, 0, TILE, TILE, new Uint8Array(TILE * TILE * 4).fill(i))
      h.commit('paint', state(String(i), new Map([['A.png', current]])))
    }
    expect(h.retainedBytes()).toBeLessThanOrEqual(tileBytes * 2.5)
    expect(h.depth).toBeLessThan(4)
    expect(h.depth).toBeGreaterThan(0)
  })
})

describe('RasterSource', () => {
  it('shares untouched tiles and reads regions back', () => {
    const w = TILE + 10, h = 20
    const a = RasterSource.blank(w, h, 1, 255)
    const patch = new Uint8Array(TILE * h).fill(7)
    const b = a.withRegion(0, 0, TILE, h, patch)
    expect(b.tiles[1]).toBe(a.tiles[1]) // The edge tile, untouched, is still the shared fill.
    const px = b.toPixels()
    expect(px[0]).toBe(7)
    expect(px[TILE + 5]).toBe(255)
    expect(b.region(TILE, 0, 10, 2)).toEqual(new Uint8Array(20).fill(255))
  })
})
