// Opening a `.comp` package in the browser: a dropped or picked folder, or a zip of one. A package is
// `manifest.json` plus `images/<layer UUID>.png` and `images/<layer UUID>.mask.png` (upstream docs/writing-comp-files.md).

import { unzipSync } from 'fflate'
import { parseManifest, type Manifest } from '../model/manifest'
import type { AssetStore, PixelSource } from '../engine/compositor'

/** Package-relative path → file contents. */
export type PackageFiles = Map<string, Blob>

export interface LoadedProject {
  name: string
  manifest: Manifest
  assets: Map<string, PixelSource>
  /** `QuickLook/Preview.jpg`, which the desktop app writes on every save: a reference for checking our rendering. */
  preview?: ImageBitmap
  warnings: string[]
}

export function assetStore(assets: Map<string, PixelSource>): AssetStore {
  return { get: (file) => assets.get(file) }
}

/** Strips everything up to the package root, found as the folder holding `manifest.json`. */
function rooted(entries: [string, Blob][]): PackageFiles {
  const manifestPath = entries
    .map(([path]) => path)
    .filter((path) => path === 'manifest.json' || path.endsWith('/manifest.json'))
    .sort((a, b) => a.length - b.length)[0]
  if (!manifestPath) throw new Error('No manifest.json found. Pick the .comp package itself.')
  const prefix = manifestPath.slice(0, -'manifest.json'.length)
  const files: PackageFiles = new Map()
  for (const [path, blob] of entries) if (path.startsWith(prefix)) files.set(path.slice(prefix.length), blob)
  return files
}

export function filesFromZip(bytes: Uint8Array): PackageFiles {
  const unzipped = unzipSync(bytes, { filter: (f) => !f.name.startsWith('__MACOSX/') })
  return rooted(Object.entries(unzipped).map(([path, data]) => [path, new Blob([data as BlobPart])]))
}

/** From `<input type="file" webkitdirectory>`, which every current browser supports. */
export function filesFromInput(list: FileList): PackageFiles {
  return rooted(Array.from(list, (f) => [f.webkitRelativePath || f.name, f] as [string, Blob]))
}

/** From a drag and drop: a folder (a `.comp` package is one) or a zip. */
export async function filesFromDrop(transfer: DataTransfer): Promise<PackageFiles> {
  const entries = Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e)
  const collected: [string, Blob][] = []
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      collected.push([path + entry.name, file])
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      for (const child of batch) await walk(child, `${path}${entry.name}/`)
    }
  }
  for (const entry of entries) await walk(entry, '')
  if (collected.length === 1 && collected[0][0].toLowerCase().endsWith('.zip'))
    return filesFromZip(new Uint8Array(await collected[0][1].arrayBuffer()))
  return rooted(collected)
}

/** Decodes a package: validates the manifest, then decodes every image it names. */
export async function loadProject(files: PackageFiles, name: string, maxTextureSize: number): Promise<LoadedProject> {
  const manifestBlob = files.get('manifest.json')
  if (!manifestBlob) throw new Error('No manifest.json in the package.')
  const manifest = parseManifest(JSON.parse(await manifestBlob.text()))
  const warnings: string[] = []
  const assets = new Map<string, PixelSource>()

  const decode = async (file: string, mask: boolean) => {
    const blob = files.get(`images/${file}`)
    if (!blob) throw new Error(`images/${file} is missing.`)
    let bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: mask ? 'none' : 'premultiply',
      colorSpaceConversion: 'none',
    })
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest > maxTextureSize) {
      const scale = maxTextureSize / longest
      warnings.push(`${file}: ${bitmap.width}×${bitmap.height} exceeds this GPU's ${maxTextureSize}px limit; shown reduced.`)
      const reduced = await createImageBitmap(bitmap, {
        resizeWidth: Math.floor(bitmap.width * scale), resizeHeight: Math.floor(bitmap.height * scale),
        resizeQuality: 'high', premultiplyAlpha: mask ? 'none' : 'premultiply', colorSpaceConversion: 'none',
      })
      bitmap.close()
      bitmap = reduced
    }
    assets.set(file, bitmap)
  }

  const jobs: Promise<void>[] = []
  for (const layer of manifest.layers) {
    if (layer.imageFile) jobs.push(decode(layer.imageFile, false))
    if (layer.maskFile) jobs.push(decode(layer.maskFile, true))
    if (layer.maskSourceID) warnings.push(`${layer.name}: clipping masks are not drawn yet.`)
    if (layer.effects) warnings.push(`${layer.name}: layer effects are not drawn yet.`)
    const kind = layer.adjustment?.kind
    if (kind && !['Levels', 'Curves', 'Exposure', 'Invert', 'Hue/Saturation'].includes(kind))
      warnings.push(`${layer.name}: ${kind} adjustments are not drawn yet.`)
  }
  await Promise.all(jobs)

  const previewBlob = files.get('QuickLook/Preview.jpg')
  const preview = previewBlob ? await createImageBitmap(previewBlob, { colorSpaceConversion: 'none' }) : undefined
  return { name, manifest, assets, preview, warnings: [...new Set(warnings)] }
}
