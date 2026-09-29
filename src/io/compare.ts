// G0.4: our rendering against the desktop app's own `QuickLook/Preview.jpg` — the document flattened on white,
// scaled to at most 1,024 px on the long side, JPEG quality 0.8 (upstream IO/ImageExporter.swift).

import type { Compositor } from '../engine/compositor'
import type { LoadedProject } from './comp'
import { assetStore } from './comp'

export interface PreviewComparison {
  psnr: number
  width: number
  height: number
  /** Our render, prepared exactly as the preview was, for showing side by side. */
  ours: ImageBitmap
}

export async function compareWithPreview(compositor: Compositor, project: LoadedProject): Promise<PreviewComparison | null> {
  const preview = project.preview
  if (!preview) return null
  const { width, height } = project.manifest
  // Full size first, as upstream renders before scaling, unless the GPU can't hold it.
  const fit = Math.min(1, compositor.maxTextureSize / Math.max(width, height), Math.sqrt(40_000_000 / (width * height)))
  const w = Math.max(1, Math.round(width * fit)), h = Math.max(1, Math.round(height * fit))
  const result = compositor.composite(project.manifest, assetStore(project.assets), w, h, { scale: fit, x: 0, y: 0 }, 'export')
  const premultiplied = compositor.read(result)
  compositor.releaseSurfaces('export')

  // Flattened on white: premultiplied color plus white wherever it's transparent.
  const flat = new Uint8ClampedArray(premultiplied.length)
  for (let i = 0; i < flat.length; i += 4) {
    const clear = 255 - premultiplied[i + 3]
    flat[i] = premultiplied[i] + clear
    flat[i + 1] = premultiplied[i + 1] + clear
    flat[i + 2] = premultiplied[i + 2] + clear
    flat[i + 3] = 255
  }
  const full = new OffscreenCanvas(w, h)
  full.getContext('2d')!.putImageData(new ImageData(flat, w, h), 0, 0)

  const scaled = new OffscreenCanvas(preview.width, preview.height)
  const g = scaled.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(full, 0, 0, preview.width, preview.height)
  const ours = g.getImageData(0, 0, preview.width, preview.height).data

  const reference = new OffscreenCanvas(preview.width, preview.height)
  const rg = reference.getContext('2d', { willReadFrequently: true })!
  rg.drawImage(preview, 0, 0)
  const theirs = rg.getImageData(0, 0, preview.width, preview.height).data

  let sum = 0
  for (let i = 0; i < ours.length; i += 4)
    for (let c = 0; c < 3; c++) {
      const d = ours[i + c] - theirs[i + c]
      sum += d * d
    }
  const mse = sum / ((ours.length / 4) * 3)
  return {
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
    width: preview.width,
    height: preview.height,
    ours: scaled.transferToImageBitmap(),
  }
}
