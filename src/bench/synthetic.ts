// A large generated document for G0.2: many full-size layers across every blend mode, with masks, a folder,
// transforms and adjustment layers — the load an ordinary compositing project puts on the canvas.

import type { LoadedProject } from '../io/comp'
import type { PixelSource } from '../engine/compositor'
import { BLEND_MODES, CURRENT_VERSION, FORMAT, fullCanvasTransform, newID, type Adjustment, type LayerRecord, type Manifest } from '../model/manifest'

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(width: number, height: number) {
  const c = new OffscreenCanvas(width, height)
  return { c, g: c.getContext('2d')! }
}

function background(width: number, height: number, rand: () => number) {
  const { c, g } = canvas(width, height)
  const sky = g.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#16213e')
  sky.addColorStop(0.55, '#e07a5f')
  sky.addColorStop(1, '#3d405b')
  g.fillStyle = sky
  g.fillRect(0, 0, width, height)
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `hsla(${rand() * 360}, 40%, ${30 + rand() * 40}%, 0.25)`
    g.fillRect(rand() * width, rand() * height, rand() * width * 0.08, rand() * height * 0.08)
  }
  return c.transferToImageBitmap()
}

function blobs(width: number, height: number, rand: () => number, hue: number) {
  const { c, g } = canvas(width, height)
  for (let i = 0; i < 24; i++) {
    const x = rand() * width, y = rand() * height, r = (0.05 + rand() * 0.2) * Math.max(width, height)
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    const h = (hue + rand() * 60) % 360
    grad.addColorStop(0, `hsla(${h}, 80%, 60%, ${0.5 + rand() * 0.5})`)
    grad.addColorStop(1, `hsla(${h}, 80%, 50%, 0)`)
    g.fillStyle = grad
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  g.strokeStyle = `hsla(${hue}, 70%, 70%, 0.6)`
  g.lineWidth = Math.max(4, width / 400)
  for (let i = 0; i < 12; i++) {
    g.beginPath()
    g.moveTo(rand() * width, rand() * height)
    g.bezierCurveTo(rand() * width, rand() * height, rand() * width, rand() * height, rand() * width, rand() * height)
    g.stroke()
  }
  return c.transferToImageBitmap()
}

function radialMask(width: number, height: number) {
  const { c, g } = canvas(width, height)
  const grad = g.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.55)
  grad.addColorStop(0, '#fff')
  grad.addColorStop(0.6, '#fff')
  grad.addColorStop(1, '#000')
  g.fillStyle = grad
  g.fillRect(0, 0, width, height)
  return c.transferToImageBitmap()
}

const IDENTITY_LEVELS = { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 }
const IDENTITY_CURVE = [{ x: 0, y: 0 }, { x: 255, y: 255 }]

export function warmCurves(lift = 147): Adjustment {
  return {
    kind: 'Curves',
    levels: { channel: 'RGB', ranges: [IDENTITY_LEVELS, IDENTITY_LEVELS, IDENTITY_LEVELS, IDENTITY_LEVELS] },
    curves: {
      channel: 'RGB',
      channels: [
        IDENTITY_CURVE,
        [{ x: 0, y: 0 }, { x: 120, y: lift }, { x: 255, y: 255 }],
        [{ x: 0, y: 0 }, { x: 100, y: 114 }, { x: 255, y: 255 }],
        [{ x: 0, y: 0 }, { x: 115, y: 97 }, { x: 255, y: 238 }],
      ],
    },
  }
}

export async function syntheticProject(pixelLayers = 20, width = 4000, height = 3000): Promise<LoadedProject> {
  const rand = prng(42)
  const assets = new Map<string, PixelSource>()
  const layers: LayerRecord[] = []
  const add = (layer: Omit<LayerRecord, 'id' | 'isVisible' | 'transform'> & Partial<LayerRecord>) => {
    const id = layer.id ?? newID()
    const record: LayerRecord = { id, isVisible: true, transform: fullCanvasTransform(width, height), ...layer }
    layers.push(record)
    return record
  }

  const folder = add({ name: 'Folder', isGroup: true, opacity: 0.85 })
  const modes = BLEND_MODES.filter((m) => m !== 'Normal')
  for (let i = 0; i < pixelLayers; i++) {
    const id = newID()
    assets.set(`${id}.png`, i === 0 ? background(width, height, rand) : blobs(width, height, rand, (i * 47) % 360))
    const record: LayerRecord = {
      id, name: i === 0 ? 'Background' : `Layer ${i}`, isVisible: true, imageFile: `${id}.png`,
      opacity: i === 0 ? 1 : 0.6 + rand() * 0.4,
      blendMode: i === 0 ? 'Normal' : modes[(i - 1) % modes.length],
      transform: fullCanvasTransform(width, height),
    }
    if (i % 5 === 3) {
      // Scaled and rotated, so transforms and soft edges carry weight too.
      record.transform = { ...record.transform, origin: [width * 0.1, height * 0.1], size: [width * 0.8, height * 0.8], rotation: 8 * i }
    }
    if (i % 4 === 2) {
      assets.set(`${id}.mask.png`, radialMask(width, height))
      record.maskFile = `${id}.mask.png`
      record.maskEnabled = true
    }
    if (i >= pixelLayers - 4 && i > 0) record.parentID = folder.id
    layers.push(record)
    if (i === Math.floor(pixelLayers / 2)) add({ name: 'Warm Curves', adjustment: warmCurves() })
  }
  // The folder's record sits just above its children, which are contiguous, as a subtree is.
  layers.splice(layers.indexOf(folder), 1)
  layers.push(folder)
  add({ name: 'Hue/Saturation', adjustment: { kind: 'Hue/Saturation', hue: 8, saturation: 18, lightness: 0, colorize: false } })
  add({
    name: 'Levels',
    adjustment: {
      kind: 'Levels',
      levels: { channel: 'RGB', ranges: [{ ...IDENTITY_LEVELS, black: 12, white: 240, gamma: 1.1 }, IDENTITY_LEVELS, IDENTITY_LEVELS, IDENTITY_LEVELS] },
    },
  })
  add({ name: 'Exposure', adjustment: { kind: 'Exposure', exposureSettings: { exposure: 0.2, offset: 0, gamma: 1 } } })

  const manifest: Manifest = {
    format: FORMAT, version: CURRENT_VERSION, colorSpace: 'sRGB', documentID: newID(),
    width, height, resolution: 72, activeLayerID: layers[layers.length - 1].id, layers,
  }
  return { name: `Synthetic ${pixelLayers}×${width}×${height}`, manifest, assets, warnings: [] }
}
