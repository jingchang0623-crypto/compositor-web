// Where painting and fills land, shared by the brush and the selection commands: the active layer's pixels or its
// mask, made full size when they aren't yet, and the maps between the canvas and those pixels.

import type { PixelSource } from '../engine/compositor'
import { mul3 } from '../engine/gl'
import type { PaintOptions, PaintTarget, Stroke } from '../engine/paint'
import { PaintEngine } from '../engine/paint'
import { RasterSource } from '../engine/raster'
import type { LayerRecord, LayerTransform } from '../model/manifest'
import { invert3, unitToDocument } from '../model/renderList'
import { rasterize, type Selection } from '../model/selection'
import { engine } from './CanvasView'
import { activeTab, edit, getState, notify, previewAssets, replaceDoc, resetPreview, type Tab } from './store'

let paint: PaintEngine | null = null
export function paintEngine(): PaintEngine | null {
  if (!paint && engine.compositor) paint = new PaintEngine(engine.compositor)
  return paint
}

export interface Resolved {
  tab: Tab
  layer: LayerRecord
  file: string
  mask: boolean
  target: PaintTarget
  /** How the target's pixels sit on the canvas. */
  placement: LayerTransform
  /** Document pixels → target pixels. */
  toTarget: Float32Array
  /** The layer record once the stroke lands (pointing at the file if it didn't before). */
  record: LayerRecord
}

/** The single value of a uniform (1×1) raster, or null. */
function uniformValue(source: PixelSource | undefined): number | null {
  if (!(source instanceof RasterSource) || source.width !== 1 || source.height !== 1) return null
  const [tile, at] = source.pixel(0, 0)
  return tile ? tile[at] : source.fill
}

/** What the active layer paints into, or null (with a word to the person) when it can't be painted. */
export function resolveTarget(): Resolved | null {
  const tab = activeTab()
  const layer = tab?.doc.layers.find((l) => l.id === tab.activeLayerID)
  if (!tab || !layer) { notify('先选中一个图层'); return null }
  if (layer.isGroup) { notify('文件夹没有像素：选中里面的图层，或它的蒙版'); return null }
  if (!layer.isVisible) { notify('图层已隐藏'); return null }
  const mask = tab.target === 'mask' || !!layer.adjustment
  const image = layer.imageFile ? tab.assets.get(layer.imageFile) : undefined
  const [lw, lh] = [Math.max(1, Math.round(layer.transform.size[0])), Math.max(1, Math.round(layer.transform.size[1]))]
  let file: string, source: PixelSource | null, width: number, height: number, fill: number, placement: LayerTransform
  const record: LayerRecord = { ...layer }
  if (mask) {
    file = layer.maskFile ?? `${layer.id}.mask.png`
    source = layer.maskFile ? tab.assets.get(layer.maskFile) ?? null : null
    placement = layer.maskLinked === false && layer.maskPlacement ? layer.maskPlacement : layer.transform
    // A mask covers the layer's own pixels, at their size (upstream docs); without pixels, the layer's box.
    width = image?.width ?? lw
    height = image?.height ?? lh
    fill = uniformValue(source ?? undefined) ?? 255
    if (source && (source.width !== width || source.height !== height) && uniformValue(source) === null) {
      // A mask of another size (unlinked, or resampled): paint it at its own size.
      width = source.width
      height = source.height
    }
    if (!layer.maskFile) { record.maskFile = file; record.maskEnabled = true }
  } else {
    file = layer.imageFile ?? `${layer.id}.png`
    source = image ?? null
    placement = layer.transform
    width = image?.width ?? lw
    height = image?.height ?? lh
    fill = 0
    record.imageFile = file
    // Painting rasterizes: editable text and shape settings no longer describe the pixels (upstream format notes).
    delete record.text
    delete record.shape
  }
  // Target pixel → unit square → document; and back.
  const toDoc = mul3(unitToDocument(placement), new Float32Array([1 / width, 0, 0, 0, 1 / height, 0, 0, 0, 1]))
  return {
    tab, layer, file, mask, placement, record,
    target: { source, width, height, mask, fill },
    toTarget: invert3(toDoc),
  }
}

// Selection masks as textures, made once per selection.
const selections = new WeakMap<Selection, WebGLTexture>()

export function paintOptions(r: Resolved, erase: boolean, opacity: number, color?: [number, number, number]): PaintOptions {
  const { colors } = getState()
  const fg = color ?? colors.fg
  // Masks take the color's gray; Erase on a mask paints like the brush, as in the desktop app.
  const gray = 0.299 * fg[0] + 0.587 * fg[1] + 0.114 * fg[2]
  const options: PaintOptions = r.mask
    ? { mode: 'mask', color: [gray, gray, gray], opacity }
    : { mode: erase ? 'erase' : 'paint', color: fg, opacity }
  const sel = r.tab.selection
  const p = paintEngine()
  if (sel && p) {
    let texture = selections.get(sel)
    const { width: dw, height: dh } = r.tab.doc
    if (!texture) {
      texture = p.selectionTexture(rasterize(sel, dw, dh), dw, dh)
      selections.set(sel, texture)
    }
    // Target pixel → document → the selection texture's 0–1 coordinates.
    const toDoc = invert3(r.toTarget)
    options.selection = { texture, toSelection: mul3(new Float32Array([1 / dw, 0, 0, 0, 1 / dh, 0, 0, 0, 1]), toDoc) }
  }
  return options
}

/** Shows a stroke's pixels on the canvas while it's under way. */
export function showPreview(r: Resolved, stroke: Stroke) {
  const tab = activeTab()
  if (!tab) return
  if (tab.doc.layers.find((l) => l.id === r.layer.id)?.[r.mask ? 'maskFile' : 'imageFile'] !== r.file)
    replaceDoc({ ...tab.doc, layers: tab.doc.layers.map((l) => (l.id === r.layer.id ? r.record : l)) })
  previewAssets(new Map(tab.assets).set(r.file, stroke.preview()))
}

/** Lands a finished stroke or fill as one undo step. */
export function commitStroke(name: string, r: Resolved, stroke: Stroke) {
  const result = stroke.finish()
  if (!result) { resetPreview(); return }
  edit(name, (s) => ({
    doc: { ...s.doc, layers: s.doc.layers.map((l) => (l.id === r.layer.id ? { ...l, ...pick(r.record, l) } : l)) },
    assets: new Map(s.assets).set(r.file, result),
  }))
}

/** The fields a stroke changes on its layer record. */
function pick(record: LayerRecord, current: LayerRecord): Partial<LayerRecord> {
  const out: Partial<LayerRecord> = { imageFile: record.imageFile, maskFile: record.maskFile, maskEnabled: record.maskEnabled ?? current.maskEnabled }
  if (!('text' in record)) out.text = undefined
  if (!('shape' in record)) out.shape = undefined
  return out
}
