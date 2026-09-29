// Each tool's options, in the bar above the canvas: the Move tool's exact position, size, angle and flips; the
// brush's size, hardness and opacity; the marquee's shape.

import { FlipHorizontal2, FlipVertical2, Link2, Link2Off } from 'lucide-react'
import { useRef, useState } from 'react'
import { rotated, type Point } from '../model/transform'
import { activeLayer, editLayers, seal, setAutoSelect, setBrush, setLockAspect, setMarquee, setShowTransform, useEditor } from './store'
import { transformable } from './tools/move'

/**
 * A number you can type, step with the arrow keys (Shift for tens), or scrub by dragging its label left and right, as
 * in Photoshop. A scrub or a run of steps is one undo step.
 */
export function NumberField({ label, value, onChange, step = 1, min = -Infinity, max = Infinity, unit, digits = 0, width = 58 }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; digits?: number; width?: number
}) {
  const [text, setText] = useState<string | null>(null)
  const scrub = useRef<{ x: number; value: number } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const shown = text ?? value.toFixed(digits)
  return (
    <label className="number-field">
      <span
        className="scrub" title="左右拖动调整"
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); scrub.current = { x: e.clientX, value } }}
        onPointerMove={(e) => {
          if (!scrub.current) return
          const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
          onChange(clamp(+(scrub.current.value + Math.round((e.clientX - scrub.current.x) / 2) * step * k).toFixed(digits)))
        }}
        onPointerUp={() => { scrub.current = null; seal() }}
      >{label}</span>
      <input
        style={{ width }} value={shown} inputMode="decimal" aria-label={label}
        onFocus={(e) => { setText(value.toFixed(digits)); e.currentTarget.select() }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = parseFloat(text ?? '')
          if (text !== null && Number.isFinite(n) && n !== value) { onChange(clamp(n)); seal() }
          setText(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setText(null); e.currentTarget.blur() }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const next = clamp(+(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(digits))
            onChange(next)
            setText(next.toFixed(digits))
          }
        }}
        onKeyUp={(e) => { if (e.key.startsWith('Arrow')) seal() }}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  )
}

export function MoveOptions() {
  const layer = useEditor(activeLayer)
  const autoSelect = useEditor((s) => s.autoSelect)
  const show = useEditor((s) => s.showTransform)
  const lock = useEditor((s) => s.lockAspect)
  const t = transformable(layer) ? layer.transform : null
  const set = (name: string, change: (c: Point & { w: number; h: number; r: number }) => Partial<Point & { w: number; h: number; r: number }>) => {
    if (!t || !layer) return
    const cur = { x: t.origin[0], y: t.origin[1], w: t.size[0], h: t.size[1], r: t.rotation }
    const next = { ...cur, ...change(cur) }
    // Size changes keep the box's center, like Photoshop's W and H fields.
    const cx = next.x + cur.w / 2, cy = next.y + cur.h / 2
    const sized = next.w !== cur.w || next.h !== cur.h
    const transform = rotated({
      ...t,
      origin: sized ? [cx - next.w / 2, cy - next.h / 2] : [next.x, next.y],
      size: [next.w, next.h],
    }, next.r)
    editLayers(name, (l) => (l.id === layer.id ? { ...l, transform } : null), `field:${name}`)
  }
  return (
    <>
      <label className="check"><input type="checkbox" checked={autoSelect} onChange={(e) => setAutoSelect(e.target.checked)} /> 自动选择</label>
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShowTransform(e.target.checked)} /> 显示变换控件</label>
      {t && (
        <>
          <span className="divider" />
          <NumberField label="X" value={t.origin[0]} onChange={(x) => set('X', () => ({ x }))} />
          <NumberField label="Y" value={t.origin[1]} onChange={(y) => set('Y', () => ({ y }))} />
          <NumberField label="W" value={t.size[0]} min={1} onChange={(w) => set('宽度', (c) => (lock ? { w, h: Math.max(1, Math.round((c.h * w) / c.w)) } : { w }))} />
          <button className="icon" aria-pressed={lock} title={lock ? '锁定宽高比（Shift 拖动时反转）' : '不锁定宽高比'} onClick={() => setLockAspect(!lock)}>
            {lock ? <Link2 size={15} /> : <Link2Off size={15} />}
          </button>
          <NumberField label="H" value={t.size[1]} min={1} onChange={(h) => set('高度', (c) => (lock ? { h, w: Math.max(1, Math.round((c.w * h) / c.h)) } : { h }))} />
          <NumberField label="角度" value={t.rotation} step={1} min={-180} max={180} unit="°" width={48} onChange={(r) => set('旋转', () => ({ r }))} />
          <button className="icon" title="水平翻转" aria-label="水平翻转" onClick={() => { editLayers('水平翻转', (l) => (l.id === layer!.id ? { ...l, transform: { ...l.transform, flipX: !l.transform.flipX } } : null)); seal() }}><FlipHorizontal2 size={16} /></button>
          <button className="icon" title="垂直翻转" aria-label="垂直翻转" onClick={() => { editLayers('垂直翻转', (l) => (l.id === layer!.id ? { ...l, transform: { ...l.transform, flipY: !l.transform.flipY } } : null)); seal() }}><FlipVertical2 size={16} /></button>
        </>
      )}
    </>
  )
}

export function BrushOptions() {
  const brush = useEditor((s) => s.brush)
  const target = useEditor((s) => (s.tabs.find((t) => t.id === s.activeTabID)?.target))
  return (
    <>
      <div className="segmented" role="group" aria-label="模式">
        <button aria-pressed={!brush.erase} onClick={() => setBrush({ erase: false })}>画笔 B</button>
        <button aria-pressed={brush.erase} onClick={() => setBrush({ erase: true })} disabled={target === 'mask'} title={target === 'mask' ? '在蒙版上，橡皮与画笔相同：涂前景色' : undefined}>橡皮 E</button>
      </div>
      <NumberField label="大小" value={brush.size} min={1} max={2000} unit="px" onChange={(size) => setBrush({ size })} />
      <NumberField label="硬度" value={Math.round(brush.hardness * 100)} min={0} max={100} unit="%" width={44} onChange={(h) => setBrush({ hardness: h / 100 })} />
      <NumberField label="不透明度" value={Math.round(brush.opacity * 100)} min={1} max={100} unit="%" width={44} onChange={(o) => setBrush({ opacity: o / 100 })} />
      {target === 'mask' && <span className="soon">正在画蒙版：黑色隐藏，白色显示（X 切换）</span>}
    </>
  )
}

export function MarqueeOptions() {
  const kind = useEditor((s) => s.marquee)
  return (
    <>
      <div className="segmented" role="group" aria-label="形状">
        <button aria-pressed={kind === 'rectangle'} onClick={() => setMarquee('rectangle')}>矩形</button>
        <button aria-pressed={kind === 'ellipse'} onClick={() => setMarquee('ellipse')}>椭圆</button>
      </div>
      <span className="soon">Shift 加选 · Option 减选 · 拖动中按 Shift 为正方形/圆 · 在选区内拖动可移动选区</span>
    </>
  )
}
