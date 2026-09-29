// Layer commands: what the layers panel, menus and keys do to the document. Each is one undo step.

import { RasterSource } from '../engine/raster'
import {
  adjustmentLayer, descendants, duplicate as duplicateRecords, folderLayer, groupLayer, insertInto, insertionPoint,
  moveLayer, nextName, pixelLayer, removeLayers, ungroup,
} from '../model/document'
import { fullCanvasTransform, type AdjustmentKind, type BlendMode, type LayerRecord, type Manifest } from '../model/manifest'
import { commitStroke, paintEngine, paintOptions, resolveTarget } from './paintTarget'
import { activeLayer, activeTab, edit, notify, selectLayer, setSelection, setTarget, updateLayer } from './store'

/** Adds a record where a new layer goes (above the active one, or on top of an active folder) and selects it. */
function addRecord(name: string, make: (doc: Manifest) => LayerRecord) {
  const tab = activeTab()
  if (!tab) return
  const record = make(tab.doc)
  const at = insertionPoint(tab.doc.layers, tab.activeLayerID)
  edit(name, (s) => ({ ...s, doc: { ...s.doc, layers: insertInto(s.doc.layers, at.parentID, at.anchorID, [record]) } }), undefined, record.id)
}

/** A transparent layer the size of the canvas. No pixels until something is painted. */
export const addBlankLayer = () =>
  addRecord('新建图层', (doc) => pixelLayer(nextName(doc.layers, 'Layer'), fullCanvasTransform(doc.width, doc.height)))

export const addFolder = () =>
  addRecord('新建文件夹', (doc) => folderLayer(nextName(doc.layers, 'Folder'), doc.width, doc.height))

export const addAdjustment = (kind: AdjustmentKind) =>
  addRecord(`新建 ${kind} 调整图层`, (doc) => adjustmentLayer(kind, doc.width, doc.height))

export function groupActive() {
  const layer = activeLayer(), tab = activeTab()
  if (!layer || !tab) return
  const folder = folderLayer(nextName(tab.doc.layers, 'Folder'), tab.doc.width, tab.doc.height)
  edit('编组', (s) => ({ ...s, doc: { ...s.doc, layers: groupLayer(s.doc.layers, layer.id, folder) } }), undefined, folder.id)
}

export function ungroupActive() {
  const layer = activeLayer()
  if (!layer?.isGroup) return notify('选中一个文件夹再取消编组')
  const first = descendants(activeTab()!.doc.layers, layer.id)[0]
  edit('取消编组', (s) => ({ ...s, doc: { ...s.doc, layers: ungroup(s.doc.layers, layer.id) } }))
  if (first) selectLayer(first.id)
}

export function deleteLayer(id = activeLayer()?.id) {
  const tab = activeTab()
  const layer = tab?.doc.layers.find((l) => l.id === id)
  if (!tab || !layer) return
  // The next layer down (or up) becomes active, as in Photoshop.
  const visible = tab.doc.layers.filter((l) => l.parentID === layer.parentID)
  const index = visible.indexOf(layer)
  const neighbour = visible[index - 1] ?? visible[index + 1] ?? tab.doc.layers.find((l) => l.id === layer.parentID)
  edit(`删除 ${layer.name}`, (s) => {
    const layers = removeLayers(s.doc.layers, [layer.id])
    const used = new Set(layers.flatMap((l) => [l.imageFile, l.maskFile].filter(Boolean) as string[]))
    const assets = new Map([...s.assets].filter(([file]) => used.has(file)))
    return { doc: { ...s.doc, layers }, assets }
  })
  if (neighbour) selectLayer(neighbour.id)
}

export function duplicateLayer(id = activeLayer()?.id) {
  const tab = activeTab()
  const layer = tab?.doc.layers.find((l) => l.id === id)
  if (!tab || !layer) return
  const { records, rename } = duplicateRecords(tab.doc.layers, layer.id, (n) => `${n} copy`)
  edit(`复制 ${layer.name}`, (s) => {
    const assets = new Map(s.assets)
    // The copies share the originals' pixels: sources never change once made.
    for (const [from, to] of rename) { const src = s.assets.get(from); if (src) assets.set(to, src) }
    return { doc: { ...s.doc, layers: insertInto(s.doc.layers, layer.parentID, layer.id, records) }, assets }
  }, undefined, records[0]?.id)
}

export function renameLayer(id: string, name: string) {
  const trimmed = name.trim()
  if (trimmed) updateLayer(id, { name: trimmed }, '重命名图层')
}

/** Moves a layer to sit among `parentID`'s children at `index` (bottom to top). */
export function moveLayerTo(id: string, parentID: string | undefined, index: number) {
  edit('移动图层', (s) => {
    const layers = moveLayer(s.doc.layers, id, parentID, index)
    return layers.every((l, i) => l === s.doc.layers[i]) && layers.length === s.doc.layers.length ? null : { ...s, doc: { ...s.doc, layers } }
  })
}

export function toggleVisibility(id: string) {
  const layer = activeTab()?.doc.layers.find((l) => l.id === id)
  if (layer) updateLayer(id, { isVisible: !layer.isVisible }, layer.isVisible ? '隐藏图层' : '显示图层')
}

/** One undo step for a whole slider drag: `seal()` ends it. */
export function setOpacity(id: string, opacity: number) {
  updateLayer(id, { opacity: Math.min(1, Math.max(0, opacity)) }, '更改不透明度', `opacity:${id}`)
}

export function setBlendMode(id: string, blendMode: BlendMode) {
  updateLayer(id, { blendMode }, '更改混合模式')
}

// MARK: Masks

/**
 * A mask that reveals everything: one white pixel, which the format allows and which stretches over the layer
 * (upstream LayerMask.swift). Painting it makes it full size. The mask becomes what painting changes.
 */
export function addMask(id = activeLayer()?.id) {
  const tab = activeTab()
  const layer = tab?.doc.layers.find((l) => l.id === id)
  if (!tab || !layer || layer.maskFile) return
  if (tab.selection) return maskFromSelection(layer.id)
  const file = `${layer.id}.mask.png`
  edit('添加蒙版', (s) => ({
    doc: { ...s.doc, layers: s.doc.layers.map((l) => (l.id === layer.id ? { ...l, maskFile: file, maskEnabled: true } : l)) },
    assets: new Map(s.assets).set(file, RasterSource.blank(1, 1, 1, 255)),
  }))
  selectLayer(layer.id, 'mask')
}

export function deleteMask(id = activeLayer()?.id) {
  const layer = activeTab()?.doc.layers.find((l) => l.id === id)
  if (!layer?.maskFile) return
  const file = layer.maskFile
  edit('删除蒙版', (s) => {
    const assets = new Map(s.assets)
    assets.delete(file)
    return {
      doc: { ...s.doc, layers: s.doc.layers.map((l) => (l.id === layer.id ? { ...l, maskFile: undefined, maskEnabled: undefined, maskLinked: undefined, maskPlacement: undefined } : l)) },
      assets,
    }
  })
  setTarget('image')
}

export function toggleMaskEnabled(id: string) {
  const layer = activeTab()?.doc.layers.find((l) => l.id === id)
  if (layer?.maskFile) updateLayer(id, { maskEnabled: layer.maskEnabled === false }, layer.maskEnabled === false ? '启用蒙版' : '停用蒙版')
}

/**
 * With a selection, a new mask shows only what's selected: black everywhere, white through the selection, at the
 * layer's own pixel size; then the selection goes, as in the desktop app (LayerMask.swift).
 */
function maskFromSelection(id: string) {
  selectLayer(id, 'mask')
  const r = resolveTarget()
  const engine = paintEngine()
  if (!r || !engine) return
  r.target.fill = 0
  r.target.source = null
  const stroke = engine.begin(r.target, paintOptions(r, false, 1, [1, 1, 1]))
  stroke.fillAll()
  commitStroke('从选区添加蒙版', r, stroke)
  setSelection(null)
}
