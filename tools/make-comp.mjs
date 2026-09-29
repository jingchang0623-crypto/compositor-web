// Writes a small `.comp` project the way upstream docs/writing-comp-files.md describes, as a folder and as a zip,
// into public/fixtures/. It exercises what the web renderer draws: blend modes, a mask, a scaled and rotated layer,
// a folder with its own opacity, and a Curves adjustment.
//
//   node tools/make-comp.mjs
//
// Open the folder in the desktop app and save it there to get a QuickLook/Preview.jpg for the PSNR check (G0.4).

import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { zipSync } from 'fflate'

const W = 1200, H = 800
const out = 'public/fixtures'
const pkg = join(out, 'demo.comp')
rmSync(pkg, { recursive: true, force: true })
mkdirSync(join(pkg, 'images'), { recursive: true })

const id = () => randomUUID().toUpperCase()
const png = (width, height, fn, gray = false) => {
  const image = new PNG({ width, height, colorType: gray ? 0 : 6, inputColorType: gray ? 0 : 6, bitDepth: 8 })
  if (gray) image.data = Buffer.alloc(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = fn(x, y)
      if (gray) image.data[y * width + x] = v
      else image.data.set(v, (y * width + x) * 4)
    }
  return PNG.sync.write(image, { colorType: gray ? 0 : 6, inputColorType: gray ? 0 : 6 })
}
const transform = (x, y, w, h, rotation = 0) => ({
  origin: [x, y], size: [w, h], rotation, flipX: false, flipY: false, sampling: 'High quality',
})
const identityLevels = { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 }

const layers = []
const add = (record, pixels, mask) => {
  if (pixels) {
    record.imageFile = `${record.id}.png`
    writeFileSync(join(pkg, 'images', record.imageFile), pixels)
  }
  if (mask) {
    record.maskFile = `${record.id}.mask.png`
    record.maskEnabled = true
    writeFileSync(join(pkg, 'images', record.maskFile), mask)
  }
  layers.push({ isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal', ...record })
  return record
}

add({ id: id(), name: 'Sky', transform: transform(0, 0, W, H) },
  png(W, H, (x, y) => [20 + (y / H) * 200, 40 + (y / H) * 90, 120 - (y / H) * 60, 255]))

add({ id: id(), name: 'Sun', blendMode: 'Screen', transform: transform(760, 110, 300, 300) },
  png(300, 300, (x, y) => {
    const d = Math.hypot(x - 150, y - 150) / 150
    return [255, 210, 120, Math.max(0, Math.min(255, (1 - d) * 400))]
  }))

add({ id: id(), name: 'Hills', blendMode: 'Multiply', opacity: 0.85, transform: transform(0, 420, W, 380) },
  png(W, 380, (x, y) => {
    const ridge = 120 + 60 * Math.sin(x / 90) + 30 * Math.sin(x / 23)
    return y > ridge ? [70, 120, 80, 255] : [0, 0, 0, 0]
  }),
  png(W, 380, (x) => Math.round(255 * Math.min(1, x / (W * 0.6))), true))

const folder = { id: id(), name: 'Overlays', isGroup: true, opacity: 0.7, transform: transform(0, 0, W, H) }
add(folder)
add({ id: id(), name: 'Stripe', parentID: folder.id, transform: transform(200, 250, 600, 90, 15) },
  png(600, 90, (x) => [230, 60 + (x / 600) * 150, 90, 220]))
add({ id: id(), name: 'Tint', parentID: folder.id, blendMode: 'Overlay', transform: transform(0, 0, W, H) },
  png(W, H, (x, y) => [60 + (x / W) * 160, 90, 200 - (y / H) * 120, 255]))

add({
  id: id(), name: 'Warm Grade', transform: transform(0, 0, W, H),
  adjustment: {
    kind: 'Curves', hue: 0, saturation: 0, lightness: 0, colorize: false,
    levels: { channel: 'RGB', ranges: [identityLevels, identityLevels, identityLevels, identityLevels] },
    curves: {
      channel: 'RGB',
      channels: [
        [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        [{ x: 0, y: 0 }, { x: 120, y: 147 }, { x: 255, y: 255 }],
        [{ x: 0, y: 0 }, { x: 100, y: 114 }, { x: 255, y: 255 }],
        [{ x: 0, y: 0 }, { x: 115, y: 97 }, { x: 255, y: 238 }],
      ],
    },
  },
})

const manifest = {
  format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: id(),
  width: W, height: H, resolution: 72, activeLayerID: layers[layers.length - 1].id, layers,
}
writeFileSync(join(pkg, 'manifest.json'), JSON.stringify(manifest, null, 2))

const files = { 'demo.comp/manifest.json': readFileSync(join(pkg, 'manifest.json')) }
for (const name of readdirSync(join(pkg, 'images'))) files[`demo.comp/images/${name}`] = readFileSync(join(pkg, 'images', name))
writeFileSync(join(out, 'demo.comp.zip'), zipSync(files))
console.log(`Wrote ${pkg}/ and ${out}/demo.comp.zip: ${layers.length} layers, ${W}×${H}`)
