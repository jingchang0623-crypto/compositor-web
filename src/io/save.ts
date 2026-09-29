// Writing a project as a `.comp` package the desktop app opens: manifest.json, images/<id>.png (RGBA) and
// images/<id>.mask.png (8-bit gray), plus QuickLook/Preview.jpg as the desktop app writes on save.

import { zipSync } from 'fflate'
import type { AssetStore, Compositor, PixelSource } from '../engine/compositor'
import { RasterSource } from '../engine/raster'
import { CURRENT_VERSION, FORMAT, type Manifest } from '../model/manifest'
import { assetStore, type PackageFiles } from './comp'
import { encodeGrayPNG } from './png'

export interface SaveInput {
  doc: Manifest
  assets: ReadonlyMap<string, PixelSource>
  activeLayerID?: string
  /** The package as opened: images whose pixels haven't changed are written back as they were. */
  original?: { files?: PackageFiles; assets: ReadonlyMap<string, PixelSource> }
}

/** Every file of the package, by path inside it. */
export type PackageOutput = Map<string, Uint8Array>

const encoded = new WeakMap<object, Promise<Uint8Array>>()

/** Premultiplied RGBA → straight RGBA, as PNG stores it. */
function unpremultiply(p: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(p.length)
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3]
    if (a === 0) continue
    if (a === 255) { out[i] = p[i]; out[i + 1] = p[i + 1]; out[i + 2] = p[i + 2]; out[i + 3] = 255; continue }
    out[i] = Math.round((p[i] * 255) / a)
    out[i + 1] = Math.round((p[i + 1] * 255) / a)
    out[i + 2] = Math.round((p[i + 2] * 255) / a)
    out[i + 3] = a
  }
  return out
}

async function canvasPNG(canvas: OffscreenCanvas): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

async function encodeImage(source: PixelSource): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(source.width, source.height)
  const g = canvas.getContext('2d')!
  if (source instanceof ImageBitmap) g.drawImage(source, 0, 0)
  else if (source instanceof RasterSource) g.putImageData(new ImageData(unpremultiply(source.toPixels()), source.width, source.height), 0, 0)
  else if ('data' in source) g.putImageData(new ImageData(unpremultiply(source.data), source.width, source.height), 0, 0)
  else throw new Error('A stroke is still being painted.')
  return canvasPNG(canvas)
}

async function encodeMask(source: PixelSource): Promise<Uint8Array> {
  let gray: Uint8Array
  if (source instanceof RasterSource) gray = source.toPixels()
  else if ('data' in source) gray = source.data
  else if (source instanceof ImageBitmap) {
    const canvas = new OffscreenCanvas(source.width, source.height)
    const g = canvas.getContext('2d', { willReadFrequently: true })!
    g.drawImage(source, 0, 0)
    const rgba = g.getImageData(0, 0, source.width, source.height).data
    gray = new Uint8Array(source.width * source.height)
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]
  } else throw new Error('A stroke is still being painted.')
  return encodeGrayPNG(source.width, source.height, gray)
}

/** PNG bytes for a source, made once per (immutable) source however many saves follow. */
function png(source: PixelSource, mask: boolean): Promise<Uint8Array> {
  let made = encoded.get(source)
  if (!made) {
    made = mask ? encodeMask(source) : encodeImage(source)
    encoded.set(source, made)
  }
  return made
}

/** The manifest as saved: the current format version, only what the desktop app reads. */
export function manifestForSave(doc: Manifest, activeLayerID?: string): Manifest {
  return {
    ...doc,
    format: FORMAT,
    version: CURRENT_VERSION,
    colorSpace: 'sRGB',
    activeLayerID: doc.layers.some((l) => l.id === activeLayerID) ? activeLayerID : doc.layers.at(-1)?.id,
    // Fields the web editor keeps only for itself never reach the file; undefined ones drop out of the JSON.
    layers: doc.layers.map((l) => ({ ...l })),
  }
}

export async function packageProject(input: SaveInput, compositor?: Compositor): Promise<PackageOutput> {
  const out: PackageOutput = new Map()
  const jobs: Promise<void>[] = []
  for (const layer of input.doc.layers) {
    for (const [file, mask] of [[layer.imageFile, false], [layer.maskFile, true]] as const) {
      if (!file) continue
      const source = input.assets.get(file)
      if (!source) throw new Error(`${layer.name}: images/${file} has no pixels.`)
      const unchanged = input.original?.assets.get(file) === source ? input.original?.files?.get(`images/${file}`) : undefined
      jobs.push((async () => {
        out.set(`images/${file}`, unchanged ? new Uint8Array(await unchanged.arrayBuffer()) : await png(source, mask))
      })())
    }
  }
  await Promise.all(jobs)
  const manifest = manifestForSave(input.doc, input.activeLayerID)
  out.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)))
  if (compositor) {
    const preview = await quickLook(compositor, input.doc, assetStore(input.assets))
    if (preview) out.set('QuickLook/Preview.jpg', preview)
  }
  return out
}

/** The document flattened on white, at most 1,024 px on its long side, JPEG quality 0.8 — upstream's Preview.jpg. */
async function quickLook(compositor: Compositor, doc: Manifest, store: AssetStore): Promise<Uint8Array | null> {
  if (doc.width * doc.height > 50_000_000) return null
  const k = Math.min(1, 1024 / Math.max(doc.width, doc.height))
  const w = Math.max(1, Math.round(doc.width * k)), h = Math.max(1, Math.round(doc.height * k))
  const blob = await flatten(compositor, doc, store, w, h, true, 'image/jpeg', 0.8)
  return new Uint8Array(await blob.arrayBuffer())
}

/** The document composited at `w`×`h` into an encoded image; on white when `opaque`. */
export async function flatten(
  compositor: Compositor, doc: Manifest, store: AssetStore, w: number, h: number, opaque: boolean, type: string, quality?: number,
): Promise<Blob> {
  const result = compositor.composite(doc, store, w, h, { scale: w / doc.width, x: 0, y: 0 }, 'export')
  const premultiplied = compositor.read(result)
  compositor.releaseSurfaces('export')
  let pixels: Uint8ClampedArray<ArrayBuffer>
  if (opaque) {
    pixels = new Uint8ClampedArray(premultiplied.length)
    for (let i = 0; i < pixels.length; i += 4) {
      const clear = 255 - premultiplied[i + 3]
      pixels[i] = premultiplied[i] + clear
      pixels[i + 1] = premultiplied[i + 1] + clear
      pixels[i + 2] = premultiplied[i + 2] + clear
      pixels[i + 3] = 255
    }
  } else pixels = unpremultiply(premultiplied)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, w, h), 0, 0)
  return canvas.convertToBlob({ type, quality })
}

// MARK: Destinations

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A zip holding `<name>.comp/…`, which unzips into a package the desktop app opens. */
export function zipPackage(name: string, files: PackageOutput): Blob {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, data] of files) entries[`${name}.comp/${path}`] = data
  // PNG and JPEG are compressed already; storing them keeps saving quick.
  return new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: 'application/zip' })
}

export const canWriteFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

async function subfolder(root: FileSystemDirectoryHandle, path: string[]): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const part of path) dir = await dir.getDirectoryHandle(part, { create: true })
  return dir
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array) {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data as unknown as FileSystemWriteChunkType)
  await writable.close()
}

/**
 * Writes the package into `folder` the way upstream asks of anything writing an open project: images first, then the
 * manifest, then removing images nothing refers to any more, so the desktop app never reads a half-written project.
 */
export async function writePackage(folder: FileSystemDirectoryHandle, files: PackageOutput) {
  const images = await subfolder(folder, ['images'])
  const written = new Set<string>()
  for (const [path, data] of files) {
    if (!path.startsWith('images/')) continue
    const name = path.slice('images/'.length)
    written.add(name)
    await writeFile(images, name, data)
  }
  const preview = files.get('QuickLook/Preview.jpg')
  if (preview) await writeFile(await subfolder(folder, ['QuickLook']), 'Preview.jpg', preview)
  await writeFile(folder, 'manifest.json', files.get('manifest.json')!)
  for await (const [name] of (images as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries())
    if (!written.has(name) && name.endsWith('.png')) await images.removeEntry(name)
}

/** Asks for a folder to save into, and makes `<name>.comp` inside it. */
export async function chooseNewPackage(name: string): Promise<FileSystemDirectoryHandle> {
  const parent = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker({ mode: 'readwrite', id: 'compositor-save' })
  return parent.getDirectoryHandle(`${name}.comp`, { create: true })
}

/** Reads a `.comp` folder picked with the File System Access API, keeping the handle for saving back. */
export async function readFolder(folder: FileSystemDirectoryHandle): Promise<PackageFiles> {
  const files: PackageFiles = new Map()
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'file') files.set(prefix + name, await (handle as FileSystemFileHandle).getFile())
      else await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`)
    }
  }
  await walk(folder, '')
  return files
}
