// The Move tool: drag to move the active layer (a folder moves everything in it), handles to resize, the circle above
// the box to rotate. Snaps to the canvas and other layers within 10 points; Control drags without snapping.

import { descendants } from '../../model/document'
import type { LayerRecord, LayerTransform } from '../../model/manifest'
import { bounds, center, corners, resized, rotated, rounded, snap, snapTargets, toDocument, toLocal, translated, type Box } from '../../model/transform'
import { engine } from '../CanvasView'
import { setOverlay } from '../overlayState'
import { activeLayer, activeTab, activeView, editLayers, getState, seal, selectLayer } from '../store'
import type { ToolController, ToolPointer } from './pointer'

/** Handles, as (side x, side y): −1 left/top, 0 middle, 1 right/bottom. */
const HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
const HANDLE_HIT = 8
const ROTATE_OFFSET = 28
const ROTATE_HIT = 10
const SNAP_POINTS = 10

/** A layer whose own box the handles act on: pixels or a shape, not a folder or an adjustment. */
export function transformable(layer: LayerRecord | null): layer is LayerRecord {
  return !!layer && !layer.isGroup && !layer.adjustment
}

/** Document → CSS pixels over the canvas. */
export function toScreen(x: number, y: number) {
  const v = activeView()?.view
  if (!v) return { x: 0, y: 0 }
  return { x: (x * v.scale + v.x) / devicePixelRatio, y: (y * v.scale + v.y) / devicePixelRatio }
}

/** Where the rotation handle sits: 28 points out from the top edge's middle, the way the box faces. */
export function rotateHandle(t: LayerTransform) {
  const top = toDocument(t, { x: 0, y: -t.size[1] / 2 })
  const c = center(t)
  const s = toScreen(top.x, top.y), sc = toScreen(c.x, c.y)
  const len = Math.hypot(s.x - sc.x, s.y - sc.y) || 1
  return { x: s.x + ((s.x - sc.x) / len) * ROTATE_OFFSET, y: s.y + ((s.y - sc.y) / len) * ROTATE_OFFSET, top: s }
}

export function handlePoints(t: LayerTransform) {
  return HANDLES.map(([hx, hy]) => {
    const d = toDocument(t, { x: (hx * t.size[0]) / 2, y: (hy * t.size[1]) / 2 })
    return { hx, hy, ...toScreen(d.x, d.y) }
  })
}

/** The layers a drag moves: the active layer, or everything inside an active folder. */
function targets(layers: readonly LayerRecord[], active: LayerRecord): LayerRecord[] {
  if (!active.isGroup) return [active]
  return descendants(layers, active.id).filter((l) => !l.isGroup)
}

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)),
  }
}

/** The topmost visible pixel layer with something under the point (for Auto Select). */
function layerAt(x: number, y: number): LayerRecord | null {
  const tab = activeTab(), compositor = engine.compositor
  if (!tab || !compositor) return null
  for (const layer of [...tab.doc.layers].reverse()) {
    if (!layer.isVisible || !layer.imageFile || layer.isGroup) continue
    const t = layer.transform
    const local = toLocal(t, { x, y })
    let u = local.x / t.size[0] + 0.5, v = local.y / t.size[1] + 0.5
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
    if (t.flipX) u = 1 - u
    if (t.flipY) v = 1 - v
    const source = tab.assets.get(layer.imageFile)
    const texture = source && compositor.existing(source)
    if (!source || !texture) return layer // Not on the GPU yet: its box is the best guess.
    const px = compositor.readTexture(texture, Math.floor(u * source.width), Math.floor(v * source.height), 1, 1, false)
    if (px[3] > 0) return layer
  }
  return null
}

type Drag =
  | { kind: 'move'; start: ToolPointer; from: Map<string, LayerTransform>; box: Box }
  | { kind: 'resize'; start: ToolPointer; id: string; from: LayerTransform; hx: number; hy: number }
  | { kind: 'rotate'; start: ToolPointer; id: string; from: LayerTransform }

export function moveTool(): ToolController {
  let drag: Drag | null = null

  const hit = (p: ToolPointer): { kind: 'rotate' } | { kind: 'resize'; hx: number; hy: number } | { kind: 'inside' } | null => {
    const layer = activeLayer()
    if (!getState().showTransform || !transformable(layer)) return null
    const t = layer.transform
    const r = rotateHandle(t)
    if (Math.hypot(p.sx - r.x, p.sy - r.y) <= ROTATE_HIT) return { kind: 'rotate' }
    for (const h of handlePoints(t)) if (Math.hypot(p.sx - h.x, p.sy - h.y) <= HANDLE_HIT) return { kind: 'resize', hx: h.hx, hy: h.hy }
    const cs = corners(t).map((c) => toScreen(c.x, c.y))
    // Inside the (possibly turned) box: on the same side of all four edges.
    const sides = cs.map((a, i) => { const b = cs[(i + 1) % 4]; return (b.x - a.x) * (p.sy - a.y) - (b.y - a.y) * (p.sx - a.x) })
    if (sides.every((s) => s >= 0) || sides.every((s) => s <= 0)) return { kind: 'inside' }
    return null
  }

  const commit = (name: string, next: Map<string, LayerTransform>) =>
    editLayers(name, (l) => (next.has(l.id) ? { ...l, transform: next.get(l.id)! } : null), 'transform')

  return {
    down(p) {
      const tab = activeTab()
      if (!tab) return false
      const onBox = hit(p)
      let layer = activeLayer()
      if (onBox?.kind === 'rotate' && layer) {
        drag = { kind: 'rotate', start: p, id: layer.id, from: layer.transform }
        return true
      }
      if (onBox?.kind === 'resize' && layer) {
        drag = { kind: 'resize', start: p, id: layer.id, from: layer.transform, hx: onBox.hx, hy: onBox.hy }
        return true
      }
      // Auto Select (⌘ flips it for one drag): the layer under the pointer, unless the press is on the active box.
      if (!onBox && getState().autoSelect !== p.meta) {
        const under = layerAt(p.x, p.y)
        if (under) { selectLayer(under.id); layer = under }
      }
      if (!layer || layer.adjustment) return false
      const moving = targets(tab.doc.layers, layer)
      if (!moving.length) return false
      drag = { kind: 'move', start: p, from: new Map(moving.map((l) => [l.id, l.transform])), box: union(moving.map((l) => bounds(l.transform))) }
      return true
    },

    move(p) {
      const tab = activeTab(), v = activeView()?.view
      if (!drag || !tab || !v) return
      const threshold = (SNAP_POINTS * devicePixelRatio) / v.scale
      if (drag.kind === 'move') {
        const from = drag.from
        let dx = Math.round(p.x - drag.start.x), dy = Math.round(p.y - drag.start.y)
        // Shift keeps the move on one axis.
        if (p.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
        let guides: { axis: 'x' | 'y'; at: number }[] = []
        if (!p.ctrl) {
          const others = tab.doc.layers.filter((l) => l.isVisible && !l.isGroup && !l.adjustment && !from.has(l.id)).map((l) => bounds(l.transform))
          const { xs, ys } = snapTargets(tab.doc.width, tab.doc.height, others)
          const b = drag.box
          const s = snap({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy }, p.shift && dx === 0 ? [] : xs, p.shift && dy === 0 ? [] : ys, threshold)
          dx += Math.round(s.dx)
          dy += Math.round(s.dy)
          guides = s.guides
        }
        setOverlay({ guides })
        commit('移动', new Map([...from].map(([id, t]) => [id, translated(t, dx, dy)])))
      } else if (drag.kind === 'resize') {
        // Proportions stay by default; Shift frees them, Option scales from the center.
        const lock = getState().lockAspect !== p.shift
        commit('缩放', new Map([[drag.id, rounded(resized(drag.from, drag.hx, drag.hy, p, lock, p.alt))]]))
      } else {
        const c = center(drag.from)
        const a0 = Math.atan2(drag.start.y - c.y, drag.start.x - c.x), a1 = Math.atan2(p.y - c.y, p.x - c.x)
        let deg = drag.from.rotation + ((a1 - a0) * 180) / Math.PI
        if (p.shift) deg = Math.round(deg / 15) * 15
        commit('旋转', new Map([[drag.id, rounded(rotated(drag.from, deg))]]))
      }
    },

    up() {
      drag = null
      seal()
      setOverlay({ guides: [] })
    },

    hover(p) {
      const h = hit(p)
      if (!h) return 'default'
      if (h.kind === 'rotate') return 'alias'
      if (h.kind === 'inside') return 'move'
      // Resize cursors follow the box's turn, to the nearest of the four.
      const angle = (((Math.atan2(h.hy, h.hx) * 180) / Math.PI + (activeLayer()?.transform.rotation ?? 0)) % 180 + 180) % 180
      const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']
      return cursors[Math.round(angle / 45) % 4]
    },
  }
}

/** Arrow keys nudge the active layer 1 px, or 10 px with Shift; a run of presses is one undo step. */
export function nudge(dx: number, dy: number) {
  const tab = activeTab(), layer = activeLayer()
  if (!tab || !layer || layer.adjustment) return
  const ids = new Set(targets(tab.doc.layers, layer).map((l) => l.id))
  editLayers('微移', (l) => (ids.has(l.id) ? { ...l, transform: translated(l.transform, dx, dy) } : null), 'nudge')
}
