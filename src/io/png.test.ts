/// <reference types="node" />
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { encodeGrayPNG } from './png'

describe('encodeGrayPNG', () => {
  it('round-trips through a standard decoder as 8-bit grayscale', () => {
    const w = 37, h = 11
    const gray = new Uint8Array(w * h).map((_, i) => (i * 13) % 256)
    const png = PNG.sync.read(Buffer.from(encodeGrayPNG(w, h, gray)), { skipRescale: true })
    expect(png.width).toBe(w)
    expect(png.height).toBe(h)
    expect((png as unknown as { colorType: number }).colorType).toBe(0)
    // pngjs expands to RGBA on read; every channel carries the gray value.
    for (let i = 0; i < w * h; i++) expect(png.data[i * 4]).toBe(gray[i])
  })
})
