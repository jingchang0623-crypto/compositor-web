// Materials for the G3 user test (docs/g3): an overcast street scene whose sky is to be replaced, and a sunset sky to
// put in its place. Generated here, so there's nothing to license. Writes into public/g3/:
//   street.jpg      the scene alone, for testers who start from an image
//   sky.jpg         the new sky
//   街景.comp.zip   the scene as a project, opened by the task card's link
//
//   node tools/make-g3.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { zipSync } from 'fflate'

const out = 'public/g3'
mkdirSync(out, { recursive: true })

// MARK: Noise

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const s = (t) => t * t * (3 - 2 * t)
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed)
  const u = s(xf), v = s(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x, y, seed, octaves = 5) {
  let sum = 0, amp = 0.5, f = 1
  for (let i = 0; i < octaves; i++) { sum += amp * valueNoise(x * f, y * f, seed + i * 17); amp *= 0.5; f *= 2 }
  return sum
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
const mix = (a, b, t) => a + (b - a) * t
const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()

// MARK: Street, overcast

function street(W, H) {
  const px = new Uint8Array(W * H * 4)
  const set = (x, y, r, g, b) => { const i = (y * W + x) * 4; px[i] = clamp(r); px[i + 1] = clamp(g); px[i + 2] = clamp(b); px[i + 3] = 255 }
  const base = 1180
  // Buildings: flat roofs between y 520 and 980, so the sky meets them in straight edges a marquee can follow.
  const buildings = []
  for (let x = -40; x < W; ) {
    const w = 130 + Math.floor(rand() * 150)
    buildings.push({ x0: x, x1: x + w, top: 520 + Math.floor(rand() * 460), tone: 78 + rand() * 50, hue: rand() * 10 - 5, antenna: rand() < 0.3 })
    x += w + (rand() < 0.3 ? 20 + Math.floor(rand() * 40) : 0)
  }
  const buildingAt = (x, y) => buildings.find((b) => x >= b.x0 && x < b.x1 && y >= b.top && y < base)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const b = y < base ? buildingAt(x, y) : null
      if (y >= base) {
        // Street and pavement: cool asphalt, lane marks.
        const n = fbm(x / 9, y / 9, 3, 3) * 18
        let v = 72 + n + (y - base) * 0.03
        if (y > 1360 && y < 1372 && (x % 180) < 110) v = 190
        if (y < base + 26) v = 118 + n * 0.6 // curb
        set(x, y, v - 4, v, v + 6)
      } else if (b) {
        const lx = x - b.x0, ly = y - b.top
        let v = b.tone + fbm(x / 20, y / 20, 5, 3) * 14 - 7
        // Windows in a grid, some lit (cool fluorescent, as on an overcast afternoon).
        const col = Math.floor((lx - 14) / 26), row = Math.floor((ly - 18) / 34)
        const inWindow = lx > 14 && lx < b.x1 - b.x0 - 12 && ly > 18 && (lx - 14) % 26 < 16 && (ly - 18) % 34 < 22
        if (ly < 5) v += 26 // roof edge catching the light
        if (inWindow) {
          const lit = hash(col + b.x0, row, 9) < 0.18
          set(x, y, lit ? 200 : v * 0.55, lit ? 205 : v * 0.6, lit ? 190 : v * 0.7)
        } else set(x, y, v + b.hue, v + 2, v + 8 - b.hue)
      } else {
        // Overcast sky: pale, flat, a faint cloud texture.
        const t = y / base
        const n = (fbm(x / 260, y / 160, 1) - 0.5) * 14
        set(x, y, mix(188, 214, t) + n, mix(196, 219, t) + n, mix(206, 224, t) + n)
      }
    }
  // Antennas: thin masts above a few roofs.
  for (const b of buildings) if (b.antenna) {
    const x0 = Math.floor((b.x0 + b.x1) / 2 + (rand() - 0.5) * 60), h = 50 + Math.floor(rand() * 70)
    for (let y = b.top - h; y < b.top; y++) for (let x = x0; x < x0 + 3; x++) if (x >= 0 && x < W) set(x, y, 60, 62, 66)
  }
  // Trees along the pavement, in front of the building bases: rounded, dark, desaturated.
  for (let i = 0; i < 26; i++) {
    const cx = i * (W / 25) + (rand() - 0.5) * 60, cy = 1105 + rand() * 40, r = 55 + rand() * 35
    for (let y = Math.floor(cy - r); y < Math.min(base + 30, cy + r); y++)
      for (let x = Math.floor(cx - r); x < cx + r; x++) {
        if (x < 0 || x >= W || y < 0) continue
        const d = Math.hypot((x - cx) / r, (y - cy) / r) + (fbm(x / 14, y / 14, 11, 3) - 0.5) * 0.5
        if (d < 1) { const n = fbm(x / 7, y / 7, 13, 3) * 30; set(x, y, 44 + n * 0.6, 58 + n, 52 + n * 0.7) }
      }
    // Trunk
    for (let y = Math.floor(cy + r * 0.6); y < base + 20; y++) for (let x = Math.floor(cx - 5); x < cx + 5; x++) if (x >= 0 && x < W) set(x, y, 50, 46, 44)
  }
  return px
}

// MARK: Sky, sunset

function sky(W, H) {
  const px = new Uint8Array(W * H * 4)
  const stops = [[0, [20, 32, 86]], [0.45, [96, 72, 138]], [0.72, [214, 112, 110]], [0.88, [250, 160, 88]], [1, [255, 204, 130]]]
  const grad = (t) => {
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0)
      return c0.map((c, j) => mix(c, c1[j], k))
    }
    return stops.at(-1)[1]
  }
  const sun = { x: W * 0.68, y: H * 0.93 }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = y / H
      let [r, g, b] = grad(t)
      // Clouds: soft bands, lit warm from below near the horizon, dusky above.
      const c = fbm(x / 420, y / 120, 21) * 1.2 + fbm(x / 90, y / 60, 31, 3) * 0.3 - 0.62
      const cover = Math.max(0, Math.min(1, c * 2.4)) * (0.35 + t * 0.65)
      const lit = [mix(90, 255, t), mix(60, 150, t * t), mix(110, 120, t)]
      r = mix(r, lit[0], cover * 0.8); g = mix(g, lit[1], cover * 0.8); b = mix(b, lit[2], cover * 0.8)
      // The sun's glow.
      const d = Math.hypot(x - sun.x, (y - sun.y) * 1.6) / W
      const glow = Math.exp(-d * 9) * 0.8 + Math.exp(-d * 60) * 0.9
      r += glow * 90; g += glow * 70; b += glow * 30
      const i = (y * W + x) * 4
      px[i] = clamp(r); px[i + 1] = clamp(g); px[i + 2] = clamp(b); px[i + 3] = 255
    }
  return px
}

// MARK: Files

const SW = 2400, SH = 1600
const streetPx = street(SW, SH)
writeFileSync(join(out, 'street.jpg'), jpeg.encode({ data: streetPx, width: SW, height: SH }, 90).data)
const skyW = 2400, skyH = 1400
writeFileSync(join(out, 'sky.jpg'), jpeg.encode({ data: sky(skyW, skyH), width: skyW, height: skyH }, 90).data)

// The start project: the scene as one layer, as the desktop app would save it.
const id = '5E3A1C2B-8F4D-4B6A-9C1E-7D2F3A4B5C6D'
const png = new PNG({ width: SW, height: SH })
png.data = Buffer.from(streetPx)
const manifest = {
  format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: 'A7C3E9F1-2B4D-4E6F-8A1C-3D5E7F9B1C2D',
  width: SW, height: SH, resolution: 72, activeLayerID: id,
  layers: [{
    id, name: '街景', isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal', imageFile: `${id}.png`,
    transform: { origin: [0, 0], size: [SW, SH], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' },
  }],
}
writeFileSync(join(out, '街景.comp.zip'), zipSync({
  '街景.comp/manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  [`街景.comp/images/${id}.png`]: PNG.sync.write(png),
}, { level: 0 }))
console.log('Wrote public/g3/street.jpg, sky.jpg, 街景.comp.zip')
