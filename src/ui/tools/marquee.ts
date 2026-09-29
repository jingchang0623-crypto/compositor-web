// The Marquee (M): drag a rectangle or ellipse. Shift adds and Option subtracts (held at the start); Shift during the
// drag makes it square. Dragging inside the selection moves its outline; a click outside deselects.

import { combine, contains, translate, type Selection, type SelectionShape } from '../../model/selection'
import { setOverlay } from '../overlayState'
import { activeTab, getState, setSelection } from '../store'
import type { ToolController, ToolPointer } from './pointer'

export function marqueeTool(): ToolController {
  let drag: { kind: 'new'; start: ToolPointer; op: 'add' | 'subtract' | 'replace' } | { kind: 'move'; start: ToolPointer; from: Selection } | null = null

  const shape = (a: ToolPointer, b: ToolPointer, square: boolean): SelectionShape => {
    let w = b.x - a.x, h = b.y - a.y
    if (square) {
      const s = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w || 1) * s
      h = Math.sign(h || 1) * s
    }
    return {
      kind: getState().marquee === 'ellipse' ? 'ellipse' : 'rect', op: 'add',
      x: Math.round(Math.min(a.x, a.x + w)), y: Math.round(Math.min(a.y, a.y + h)), w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)),
    }
  }

  return {
    down(p) {
      const tab = activeTab()
      if (!tab) return false
      const sel = tab.selection
      if (sel && !p.shift && !p.alt && contains(sel, p.x, p.y)) {
        drag = { kind: 'move', start: p, from: sel }
        return true
      }
      drag = { kind: 'new', start: p, op: p.shift ? 'add' : p.alt ? 'subtract' : 'replace' }
      return true
    },
    move(p) {
      if (!drag) return
      if (drag.kind === 'move') {
        setSelection(translate(drag.from, Math.round(p.x - drag.start.x), Math.round(p.y - drag.start.y)))
        return
      }
      setOverlay({ marquee: shape(drag.start, p, p.shift && drag.op !== 'add') })
    },
    up(p) {
      const d = drag
      drag = null
      setOverlay({ marquee: null })
      if (!d || d.kind === 'move') return
      const s = shape(d.start, p, p.shift && d.op !== 'add')
      // A click (no drag) with nothing held deselects, as in Photoshop.
      if (s.w < 1 || s.h < 1) {
        if (d.op === 'replace') setSelection(null)
        return
      }
      const current = activeTab()?.selection ?? null
      if (d.op === 'replace') setSelection(combine(null, s))
      else setSelection(combine(current, { ...s, op: d.op }))
    },
    hover(p) {
      const sel = activeTab()?.selection
      return sel && !p.shift && !p.alt && contains(sel, p.x, p.y) ? 'move' : 'crosshair'
    },
    key(_e, dx, dy) {
      // Arrows nudge the outline.
      const sel = activeTab()?.selection
      if (!sel || (!dx && !dy)) return false
      setSelection(translate(sel, dx, dy))
      return true
    },
  }
}
