// What menus, buttons and keys ask of the editor, in one place.

import { filesFromDrop, filesFromInput, filesFromZip, loadProject, type PackageFiles } from '../io/comp'
import { engine } from './CanvasView'
import { activeTab, activeView, openProject, setBusy, setError, setView } from './store'
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

export async function openFrom(read: () => Promise<PackageFiles>, name: string) {
  setError(null)
  setBusy('正在读取 .comp …')
  try {
    const files = await read()
    setBusy('正在解码图层 …')
    openProject(await loadProject(files, name, engine.compositor?.maxTextureSize ?? 8192))
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

/** A `.comp` package is a folder; every current browser can pick one. */
export function pickFolder() {
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

export function openDrop(transfer: DataTransfer) {
  const name = transfer.items[0]?.getAsFile()?.name ?? 'Project'
  void openFrom(async () => {
    try {
      return await filesFromDrop(transfer)
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : e}（导入单张图片将在 G2 支持）`)
    }
  }, name)
}
