// A small PNG encoder for gray masks, which the desktop app expects as 8-bit grayscale (docs/writing-comp-files.md).
// A canvas can only write RGBA PNGs.

import { zlibSync } from 'fflate'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** `gray` is `width`×`height` bytes, top row first. Rows use the Up filter, which suits smooth masks. */
export function encodeGrayPNG(width: number, height: number, gray: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (width + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1)
    raw[row] = y === 0 ? 0 : 2
    const src = y * width
    if (y === 0) raw.set(gray.subarray(src, src + width), row + 1)
    else for (let x = 0; x < width; x++) raw[row + 1 + x] = (gray[src + x] - gray[src - width + x]) & 0xff
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
