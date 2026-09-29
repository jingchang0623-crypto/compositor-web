// The Brush (B) and Eraser (E): round dabs along the pointer's path, spaced as upstream spaces them (1.5% of the
// diameter for hard tips, 2.5% for soft), recomposed once per display frame. Shift-click draws a straight line from
// where the last stroke ended. The stroke is one undo step.

import type { Stroke } from '../../engine/paint'
import { setOverlay } from '../overlayState'
import { commitStroke, paintEngine, paintOptions, resolveTarget, showPreview, type Resolved } from '../paintTarget'
import { getState, resetPreview } from '../store'
import type { ToolController, ToolPointer } from './pointer'

export function brushTool(): ToolController {
  let stroke: Stroke | null = null
  let target: Resolved | null = null
  let last: { x: number; y: number } | null = null
  /** Where the previous stroke ended, in document pixels, for Shift-click lines. */
  let lineFrom: { x: number; y: number } | null = null
  let frame = 0

  const toTarget = (x: number, y: number) => {
    const m = target!.toTarget
    return { x: m[0] * x + m[3] * y + m[6], y: m[1] * x + m[4] * y + m[7] }
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0
      if (stroke && target) showPreview(target, stroke)
    })
  }

  /** Dabs from the last one toward (`x`, `y`), in document pixels, one spacing apart; the rest waits for more path. */
  const paintTo = (x: number, y: number) => {
    if (!stroke || !target) return
    const { size, hardness } = getState().brush
    const spacing = Math.max(0.25, size * (hardness >= 1 ? 0.015 : 0.025))
    // The radius in target pixels, per axis: a layer drawn at another scale paints at its own resolution.
    const rx = (size / 2) * (target.target.width / target.placement.size[0])
    const ry = (size / 2) * (target.target.height / target.placement.size[1])
    const dabAt = (dx: number, dy: number) => {
      const p = toTarget(dx, dy)
      stroke!.dab(p.x, p.y, rx, ry, hardness)
    }
    if (!last) {
      dabAt(x, y)
      last = { x, y }
    } else {
      const dx = x - last.x, dy = y - last.y, dist = Math.hypot(dx, dy)
      const n = Math.floor(dist / spacing)
      for (let i = 1; i <= n; i++) dabAt(last.x + (dx * i * spacing) / dist, last.y + (dy * i * spacing) / dist)
      if (n) last = { x: last.x + (dx * n * spacing) / dist, y: last.y + (dy * n * spacing) / dist }
    }
    schedule()
  }

  const cursor = (p: ToolPointer) => setOverlay({ brush: { x: p.x, y: p.y, r: getState().brush.size / 2 } })

  return {
    down(p) {
      const engine = paintEngine()
      target = resolveTarget()
      if (!engine || !target) return false
      const { brush } = getState()
      stroke = engine.begin(target.target, paintOptions(target, brush.erase, brush.opacity))
      last = null
      // Shift-click: a straight line on from where the last stroke ended.
      if (p.shift && lineFrom) paintTo(lineFrom.x, lineFrom.y)
      paintTo(p.x, p.y)
      cursor(p)
      return true
    },
    move(p) {
      cursor(p)
      if (stroke) paintTo(p.x, p.y)
    },
    up(p) {
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      if (stroke && target) {
        commitStroke(getState().brush.erase && !target.mask ? '橡皮擦' : '画笔', target, stroke)
        lineFrom = { x: p.x, y: p.y }
      }
      stroke = null
      target = null
    },
    hover(p) {
      cursor(p)
      return 'crosshair'
    },
    leave() {
      setOverlay({ brush: null })
    },
    key(e) {
      if (e.key === 'Escape' && stroke) {
        stroke.cancel()
        stroke = null
        resetPreview()
        return true
      }
      return false
    },
  }
}
