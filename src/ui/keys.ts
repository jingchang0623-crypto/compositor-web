// Keyboard shortcuts, Photoshop's where the browser lets them through. Chrome keeps ⌘N, ⌘T, ⌘W and ⇧⌘N for itself,
// so a new layer is ⌥⇧⌘N (Photoshop's "new layer without the dialog").

import { addBlankLayer, duplicateLayer, groupActive, setOpacity, ungroupActive } from './actions'
import { actualPixels, exportImage, fit, pickFolder, pickImages, save, zoomStep } from './commands'
import { deselect, inverseSelection, selectAllCanvas } from './selectionActions'
import { activeLayer, getState, redo, seal, setBrush, setColors, setTool, undo } from './store'
import { toolByKey } from './tools'

/** Keys a tool handles itself (arrows to nudge, Delete to clear), registered by the canvas. */
export const toolKeys: { handle?: (e: KeyboardEvent) => boolean } = {}

const typing = (e: KeyboardEvent) =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement

export function handleKey(e: KeyboardEvent) {
  if (typing(e)) return
  const k = e.key.toLowerCase()
  const cmd = e.metaKey || e.ctrlKey
  if (cmd) {
    const combo = `${e.shiftKey ? '⇧' : ''}${e.altKey ? '⌥' : ''}${k}`
    const actions: Record<string, () => void> = {
      z: undo, '⇧z': redo, y: redo,
      s: () => void save(), '⇧s': () => void save(true), '⇧⌥s': () => void exportImage('image/jpeg'),
      o: () => void pickFolder(), '⇧o': pickImages,
      j: () => duplicateLayer(), g: groupActive, '⇧g': ungroupActive, '⇧⌥n': addBlankLayer,
      a: selectAllCanvas, d: deselect, '⇧i': inverseSelection,
      '0': fit, '1': actualPixels, '=': () => zoomStep(1), '+': () => zoomStep(1), '-': () => zoomStep(-1),
    }
    // Option changes what e.key reports on a Mac; match the physical key for the letter shortcuts.
    const physical = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : k
    const action = actions[combo] ?? actions[`${e.shiftKey ? '⇧' : ''}${e.altKey ? '⌥' : ''}${physical}`]
    if (action) {
      e.preventDefault()
      action()
    }
    return
  }
  if (toolKeys.handle?.(e)) {
    e.preventDefault()
    return
  }
  if (e.altKey || e.repeat) return
  const s = getState()
  // Brush: [ and ] size by 1.2×, Shift for hardness in quarters (upstream EditorSession+Brush.swift).
  if (k === '[' || k === ']' || k === '{' || k === '}') {
    const up = k === ']' || k === '}'
    if (e.shiftKey) setBrush({ hardness: Math.min(1, Math.max(0, Math.round((s.brush.hardness + (up ? 0.25 : -0.25)) * 4) / 4)) })
    else {
      const size = s.brush.size
      const next = up ? Math.max(size + 1, Math.round(size * 1.2)) : Math.min(size - 1, Math.round(size / 1.2))
      setBrush({ size: Math.min(2000, Math.max(1, next)) })
    }
    e.preventDefault()
    return
  }
  // Digits set opacity: the brush's while painting, the layer's with the Move tool. 0 is 100%.
  if (/^[0-9]$/.test(k)) {
    const opacity = k === '0' ? 1 : Number(k) / 10
    if (s.tool === 'brush') setBrush({ opacity })
    else if (s.tool === 'move') {
      const layer = activeLayer()
      if (layer) { setOpacity(layer.id, opacity); seal() }
    }
    return
  }
  if (k === 'x') return setColors({ fg: s.colors.bg, bg: s.colors.fg })
  if (k === 'd') return setColors({ fg: [0, 0, 0], bg: [1, 1, 1] })
  if (k === 'b') setBrush({ erase: false })
  if (k === 'e') setBrush({ erase: true })
  const tool = toolByKey(k)
  if (tool) setTool(tool)
}
