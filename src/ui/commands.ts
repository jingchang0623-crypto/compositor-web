// What menus, buttons and keys ask of the editor, in one place.

import { filesFromDrop, filesFromInput, filesFromZip, loadProject, type PackageFiles } from '../io/comp'
import { canWriteFolders, chooseNewPackage, download, flatten, packageProject, readFolder, writePackage, zipPackage } from '../io/save'
import { engine } from './CanvasView'
import { insertInto, nextName, pixelLayer } from '../model/document'
import { newID } from '../model/manifest'
import { activeTab, activeView, edit, markSaved, newCanvas, notify, openProject, setBusy, setError, setView, type Tab } from './store'
import { fitView, keyboardZoomTarget, zoomTo } from './viewport'

// MARK: View

export function fit() {
  const tab = activeTab(), canvas = engine.canvas
  if (tab && canvas) setView(fitView(canvas.width, canvas.height, devicePixelRatio, tab.doc), true)
}

/** Zoom about the middle of the canvas. */
export function zoomCentered(zoom: number) {
  const v = activeView()?.view, canvas = engine.canvas
  if (v && canvas) setView(zoomTo(v, zoom, canvas.width / 2, canvas.height / 2))
}

export const actualPixels = () => zoomCentered(1)

export function zoomStep(step: 1 | -1) {
  const v = activeView()?.view
  if (v) zoomCentered(keyboardZoomTarget(v.scale, step))
}

// MARK: Opening

export async function openFrom(read: () => Promise<PackageFiles>, name: string, folder?: FileSystemDirectoryHandle) {
  setError(null)
  setBusy('正在读取 .comp …')
  try {
    const files = await read()
    setBusy('正在解码图层 …')
    openProject({ ...(await loadProject(files, name, engine.compositor?.maxTextureSize ?? 8192)), folder })
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e))
  } finally {
    setBusy(null)
  }
}

function pick(configure: (input: HTMLInputElement) => void, onPick: (files: FileList) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  configure(input)
  input.onchange = () => { if (input.files?.length) onPick(input.files) }
  input.click()
}

/**
 * A `.comp` package is a folder. Where the browser can write to folders (Chromium), the one picked is kept, so ⌘S saves
 * back into it; elsewhere every current browser can still read one.
 */
export async function pickFolder() {
  if (canWriteFolders()) {
    try {
      const folder = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker({ mode: 'readwrite', id: 'compositor-open' })
      return void openFrom(() => readFolder(folder), folder.name, folder)
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return
      throw e
    }
  }
  pickFolderReadOnly()
}

function pickFolderReadOnly() {
  pick((i) => { i.webkitdirectory = true }, (files) =>
    void openFrom(async () => filesFromInput(files), files[0].webkitRelativePath.split('/')[0] || 'Project'))
}

export function pickZip() {
  pick((i) => { i.accept = '.zip' }, (files) => {
    const file = files[0]
    void openFrom(async () => filesFromZip(new Uint8Array(await file.arrayBuffer())), file.name)
  })
}

export function openURL(url: string) {
  void openFrom(async () => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}：${response.status}`)
    return filesFromZip(new Uint8Array(await response.arrayBuffer()))
  }, decodeURIComponent(url.split('/').pop() ?? url))
}

export const openSample = () => openURL(`${import.meta.env.BASE_URL}fixtures/demo.comp.zip`)

/** A drop: a `.comp` folder or zip opens as a project; images become layers where they land. */
export function openDrop(transfer: DataTransfer, clientX?: number, clientY?: number) {
  const items = Array.from(transfer.items).filter((i) => i.kind === 'file')
  const entries = items.map((i) => i.webkitGetAsEntry?.())
  const files = items.map((i) => i.getAsFile()).filter((f): f is File => !!f)
  const isProject = entries.some((e) => e?.isDirectory) || files.some((f) => /\.zip$/i.test(f.name))
  if (!isProject && files.length && files.every((f) => f.type.startsWith('image/'))) {
    return void importImages(files, clientX !== undefined && clientY !== undefined ? docPoint(clientX, clientY) : undefined)
  }
  const name = files[0]?.name ?? 'Project'
  void openFrom(() => filesFromDrop(transfer), name)
}

/** A point in the window, in the active document's pixels. */
export function docPoint(clientX: number, clientY: number): { x: number; y: number } | undefined {
  const v = activeView()?.view, canvas = engine.canvas
  if (!v || !canvas) return undefined
  const r = canvas.getBoundingClientRect()
  return { x: ((clientX - r.left) * devicePixelRatio - v.x) / v.scale, y: ((clientY - r.top) * devicePixelRatio - v.y) / v.scale }
}

export function pickImages() {
  pick((i) => { i.accept = 'image/*'; i.multiple = true }, (files) => void importImages(Array.from(files)))
}

async function decode(file: Blob): Promise<ImageBitmap> {
  const max = engine.compositor?.maxTextureSize ?? 8192
  let bitmap = await createImageBitmap(file, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'default' })
  const longest = Math.max(bitmap.width, bitmap.height)
  if (longest > max) {
    const k = max / longest
    const reduced = await createImageBitmap(bitmap, {
      resizeWidth: Math.floor(bitmap.width * k), resizeHeight: Math.floor(bitmap.height * k), resizeQuality: 'high',
    })
    bitmap.close()
    bitmap = reduced
    notify(`图片超过这块 GPU 的 ${max}px 上限，已缩小导入`)
  }
  return bitmap
}

/**
 * Images as new layers, as upstream imports them: at their own pixel size, centered where they were dropped (or on
 * the canvas), named after their files, on top of the active layer's folder. With no document open, the first image
 * sets the canvas size. `paste` places them just above the active layer instead, named "Layer N".
 */
export async function importImages(files: File[], at?: { x: number; y: number }, paste = false) {
  if (!files.length) return
  setBusy('正在导入图片 …')
  try {
    const decoded = await Promise.all(files.map(decode))
    if (!activeTab()) newCanvas(decoded[0].width, decoded[0].height, paste ? undefined : files[0].name.replace(/\.[^.]+$/, ''))
    const tab = activeTab()!
    const active = tab.doc.layers.find((l) => l.id === tab.activeLayerID)
    const parentID = active?.isGroup ? active.id : active?.parentID
    const cx = at?.x ?? tab.doc.width / 2, cy = at?.y ?? tab.doc.height / 2
    const taken = [...tab.doc.layers]
    const records = decoded.map((bitmap, i) => {
      const id = newID()
      const name = paste ? nextName(taken, 'Layer') : files[i].name.replace(/\.[^.]+$/, '') || nextName(taken, 'Layer')
      const record = {
        ...pixelLayer(name, {
          origin: [Math.floor(cx - bitmap.width / 2), Math.floor(cy - bitmap.height / 2)], size: [bitmap.width, bitmap.height],
          rotation: 0, flipX: false, flipY: false, sampling: 'High quality',
        }, id),
        imageFile: `${id}.png`,
      }
      taken.push(record)
      return record
    })
    edit(paste ? '粘贴' : '导入图片', (s) => {
      let layers = s.doc.layers
      const assets = new Map(s.assets)
      let anchor = paste ? active?.id : undefined
      records.forEach((record, i) => {
        layers = insertInto(layers, paste ? active?.parentID : parentID, anchor, [record])
        if (paste) anchor = record.id
        assets.set(record.imageFile, decoded[i])
      })
      return { doc: { ...s.doc, layers }, assets }
    }, undefined, records.at(-1)?.id)
  } catch (e) {
    setError(`无法导入：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    setBusy(null)
  }
}

// MARK: Saving

async function packaged(tab: Tab) {
  return packageProject({
    doc: tab.doc, assets: tab.assets, activeLayerID: tab.activeLayerID,
    original: { files: tab.project.files, assets: tab.project.assets },
  }, engine.compositor)
}

async function busyWhile<T>(message: string, work: () => Promise<T>): Promise<T | undefined> {
  setBusy(message)
  try {
    return await work()
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    return undefined
  } finally {
    setBusy(null)
  }
}

/** ⌘S: back into the folder it came from; otherwise as a new package (or a zip, where folders can't be written). */
export async function save(as = false) {
  const tab = activeTab()
  if (!tab) return
  if (!canWriteFolders()) return downloadZip()
  await busyWhile('正在保存 …', async () => {
    const folder = !as && tab.folder ? tab.folder : await chooseNewPackage(tab.name)
    const saved = tab.history.current
    await writePackage(folder, await packaged(tab))
    tab.history.markSaved(saved)
    markSaved(tab.id, folder, folder.name.replace(/\.comp$/i, ''))
    notify(`已保存到 ${folder.name}`)
  })
}

export async function downloadZip() {
  const tab = activeTab()
  if (!tab) return
  await busyWhile('正在打包 …', async () => {
    const saved = tab.history.current
    download(zipPackage(tab.name, await packaged(tab)), `${tab.name}.comp.zip`)
    tab.history.markSaved(saved)
    markSaved(tab.id)
  })
}

/** The flattened document at full size: PNG keeps transparency, JPEG goes on white. */
export async function exportImage(type: 'image/png' | 'image/jpeg') {
  const tab = activeTab(), compositor = engine.compositor
  if (!tab || !compositor) return
  const { width, height } = tab.doc
  if (Math.max(width, height) > compositor.maxTextureSize)
    return setError(`画布 ${width}×${height} 超过这块 GPU 单张纹理的 ${compositor.maxTextureSize}px 上限，暂时无法整张导出。`)
  await busyWhile('正在导出 …', async () => {
    const blob = await flatten(compositor, tab.doc, tab.store, width, height, type === 'image/jpeg', type, 0.92)
    download(blob, `${tab.name}.${type === 'image/png' ? 'png' : 'jpg'}`)
  })
}
