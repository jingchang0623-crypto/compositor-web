// Lines over the canvas: the transform box and its handles, snap guides, the selection's marching ants, the marquee
// being dragged and the brush outline. Drawn in CSS pixels with SVG; it takes no pointer events itself.

import { useMemo } from 'react'
import { rasterize, single, trace, type Selection, type SelectionShape } from '../model/selection'
import { corners } from '../model/transform'
import { useOverlay } from './overlayState'
import { activeLayer, activeTab, activeView, useEditor } from './store'
import { handlePoints, rotateHandle, toScreen, transformable } from './tools/move'

export function Overlay() {
  const tool = useEditor((s) => s.tool)
  const show = useEditor((s) => s.showTransform)
  const layer = useEditor(activeLayer)
  const view = useEditor((s) => activeView(s)?.view)
  const tab = useEditor(activeTab)
  const guides = useOverlay((s) => s.guides)
  const marquee = useOverlay((s) => s.marquee)
  const brush = useOverlay((s) => s.brush)
  if (!view || !tab) return null

  const box = tool === 'move' && show && transformable(layer) ? layer.transform : null
  const pts = (list: { x: number; y: number }[]) => list.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <svg className="overlay" aria-hidden="true">
      {tab.selection && <SelectionOutline selection={tab.selection} width={tab.doc.width} height={tab.doc.height} />}
      {marquee && <ShapeOutline shape={marquee} />}
      {box && (() => {
        const cs = corners(box).map((c) => toScreen(c.x, c.y))
        const r = rotateHandle(box)
        return (
          <g className="transform-box">
            <polygon points={pts(cs)} />
            <line x1={r.top.x} y1={r.top.y} x2={r.x} y2={r.y} />
            <circle cx={r.x} cy={r.y} r={4.5} className="rotate" />
            {handlePoints(box).map((h) => <rect key={`${h.hx},${h.hy}`} x={h.x - 4} y={h.y - 4} width={8} height={8} />)}
          </g>
        )
      })()}
      {guides.map((g, i) => {
        const a = g.axis === 'x' ? toScreen(g.at, 0) : toScreen(0, g.at)
        return g.axis === 'x'
          ? <line key={i} className="guide" x1={a.x} y1={0} x2={a.x} y2="100%" />
          : <line key={i} className="guide" x1={0} y1={a.y} x2="100%" y2={a.y} />
      })}
      {brush && (() => {
        const c = toScreen(brush.x, brush.y)
        const r = (brush.r * view.scale) / devicePixelRatio
        return <g className="brush-cursor"><circle cx={c.x} cy={c.y} r={Math.max(1, r)} /><circle cx={c.x} cy={c.y} r={Math.max(1, r)} className="inner" /></g>
      })()}
    </svg>
  )
}

function ShapeOutline({ shape }: { shape: SelectionShape }) {
  const a = toScreen(shape.x, shape.y), b = toScreen(shape.x + shape.w, shape.y + shape.h)
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
  return (
    <g className="ants">
      {shape.kind === 'rect'
        ? <><rect x={x} y={y} width={w} height={h} /><rect x={x} y={y} width={w} height={h} className="dash" /></>
        : <><ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} /><ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} className="dash" /></>}
    </g>
  )
}

/** Marching ants: exact for one rectangle or ellipse, traced from a reduced mask for anything combined. */
function SelectionOutline({ selection, width, height }: { selection: Selection; width: number; height: number }) {
  const one = single(selection)
  // Traced once per selection, at up to 1,024 px across; drawn at any zoom by scaling the outline.
  const traced = useMemo(() => {
    if (one) return null
    const k = Math.min(1, 1024 / Math.max(width, height))
    const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k))
    return { k: width / w, loops: trace(rasterize(selection, width, height, w / width), w, h) }
  }, [selection, one, width, height])
  if (one) return <ShapeOutline shape={one} />
  if (!traced) return null
  const d = traced.loops.map((loop) => {
    const parts: string[] = []
    for (let i = 0; i < loop.length; i += 2) {
      const p = toScreen(loop[i] * traced.k, loop[i + 1] * traced.k)
      parts.push(`${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    }
    return parts.join('') + 'Z'
  }).join('')
  return <g className="ants"><path d={d} /><path d={d} className="dash" /></g>
}
