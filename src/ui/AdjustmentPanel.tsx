// Settings for the active adjustment layer, in a panel over the canvas: Levels, Curves, Hue/Saturation and Exposure,
// with the desktop app's ranges. Every change previews live; a drag is one undo step.

import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { curveValue } from '../engine/adjustments'
import type { Adjustment, CurvePoint, LevelRange } from '../model/manifest'
import { engine } from './CanvasView'
import { NumberField } from './ToolOptions'
import { activeLayer, activeTab, editLayers, seal, useEditor } from './store'

const CHANNELS = ['RGB', 'Red', 'Green', 'Blue'] as const

function useAdjustment() {
  const layer = useEditor(activeLayer)
  const adj = layer?.adjustment
  const change = (name: string, next: (a: Adjustment) => Adjustment) => {
    if (!layer) return
    editLayers(name, (l) => (l.id === layer.id && l.adjustment ? { ...l, adjustment: next(l.adjustment) } : null), `adjust:${layer.id}`)
  }
  return { layer, adj, change }
}

export function AdjustmentPanel() {
  const { layer, adj } = useAdjustment()
  const [collapsed, setCollapsed] = useState(false)
  if (!layer || !adj) return null
  const supported = ['Levels', 'Curves', 'Hue/Saturation', 'Exposure', 'Invert'].includes(adj.kind)
  return (
    <section className="card adjust" aria-label={`${adj.kind} 设置`}>
      <header>
        <strong>{adj.kind}</strong>
        <span className="sub">{layer.name}</span>
        <button className="icon" onClick={() => setCollapsed((c) => !c)} title={collapsed ? '展开' : '收起'} aria-label={collapsed ? '展开' : '收起'}>
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </header>
      {!collapsed && (
        adj.kind === 'Levels' ? <Levels /> :
        adj.kind === 'Curves' ? <Curves /> :
        adj.kind === 'Hue/Saturation' ? <HueSaturation /> :
        adj.kind === 'Exposure' ? <Exposure /> :
        adj.kind === 'Invert' ? <p className="note">反相没有参数。用图层的不透明度和蒙版控制作用范围。</p> :
        !supported && <p className="note">{adj.kind} 在 Web 版还不能编辑，设置会原样保存。</p>
      )}
    </section>
  )
}

// MARK: Histogram

/** The document's histogram (red, green, blue, and luminance), from a small render, redone shortly after edits. */
function useHistogram(): Float32Array[] | null {
  const tab = useEditor(activeTab)
  const [bins, setBins] = useState<Float32Array[] | null>(null)
  const doc = tab?.doc, store = tab?.store
  useEffect(() => {
    if (!doc || !store || !engine.compositor) return
    const timer = setTimeout(() => {
      const c = engine.compositor!
      const k = Math.min(1, 256 / Math.max(doc.width, doc.height))
      const w = Math.max(1, Math.round(doc.width * k)), h = Math.max(1, Math.round(doc.height * k))
      const px = c.read(c.composite(doc, store, w, h, { scale: k, x: 0, y: 0 }, 'histogram'))
      c.releaseSurfaces('histogram')
      const out = [0, 1, 2, 3].map(() => new Float32Array(256))
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3]
        if (!a) continue
        const r = Math.round((px[i] * 255) / a), g = Math.round((px[i + 1] * 255) / a), b = Math.round((px[i + 2] * 255) / a)
        out[0][Math.round(0.3 * r + 0.59 * g + 0.11 * b)]++
        out[1][r]++; out[2][g]++; out[3][b]++
      }
      setBins(out)
    }, 250)
    return () => clearTimeout(timer)
  }, [doc, store])
  return bins
}

function histogramPath(bins: Float32Array, w: number, h: number) {
  // Scaled to a typical peak rather than the tallest bin, so one flat background can't flatten the rest.
  const sorted = [...bins].filter((b) => b > 0).sort((a, b) => a - b)
  const peak = Math.max(1, sorted[Math.floor(sorted.length * 0.95)] * 1.2 || 1)
  let d = `M0,${h}`
  for (let i = 0; i < 256; i++) d += `L${(i / 255) * w},${h - Math.min(1, bins[i] / peak) * h}`
  return `${d}L${w},${h}Z`
}

// MARK: Levels

function Levels() {
  const { adj, change } = useAdjustment()
  const [channel, setChannel] = useState(0)
  const bins = useHistogram()
  if (!adj) return null
  const ranges = adj.levels?.ranges ?? []
  const r: LevelRange = ranges[channel] ?? { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 }
  const set = (patch: Partial<LevelRange>) => change('色阶', (a) => {
    const rs = [0, 1, 2, 3].map((i) => ({ ...(a.levels?.ranges[i] ?? { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 }) }))
    const next = { ...rs[channel], ...patch }
    // As upstream normalizes: black 0–254, white above black, gamma 0.1–9.99.
    next.black = Math.min(254, Math.max(0, next.black))
    next.white = Math.min(255, Math.max(next.black + 1, next.white))
    next.gamma = Math.min(9.99, Math.max(0.1, next.gamma))
    rs[channel] = next
    return { ...a, levels: { channel: a.levels?.channel ?? 'RGB', ranges: rs } }
  })
  const W = 256, H = 90
  return (
    <div className="adjust-body">
      <ChannelPicker value={channel} onChange={setChannel} />
      <svg className="histogram" viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label="直方图">
        {bins && <path d={histogramPath(bins[channel], W, H)} />}
        {([['black', r.black], ['gamma', r.black + (r.white - r.black) * Math.pow(0.5, r.gamma)], ['white', r.white]] as const).map(([k, x]) => (
          <polygon key={k} className={`marker ${k}`} points={`${x},${H + 2} ${x - 5},${H + 11} ${x + 5},${H + 11}`} />
        ))}
      </svg>
      <div className="field-row">
        <NumberField label="黑场" value={r.black} min={0} max={254} width={44} onChange={(black) => set({ black })} />
        <NumberField label="灰度" value={r.gamma} min={0.1} max={9.99} step={0.01} digits={2} width={44} onChange={(gamma) => set({ gamma })} />
        <NumberField label="白场" value={r.white} min={1} max={255} width={44} onChange={(white) => set({ white })} />
      </div>
      <div className="field-row">
        <NumberField label="输出黑" value={r.outputBlack} min={0} max={255} width={44} onChange={(outputBlack) => set({ outputBlack })} />
        <NumberField label="输出白" value={r.outputWhite} min={0} max={255} width={44} onChange={(outputWhite) => set({ outputWhite })} />
      </div>
    </div>
  )
}

function ChannelPicker({ value, onChange }: { value: number; onChange: (c: number) => void }) {
  return (
    <div className="segmented" role="group" aria-label="通道">
      {CHANNELS.map((c, i) => <button key={c} aria-pressed={value === i} onClick={() => onChange(i)}>{c === 'RGB' ? 'RGB' : c === 'Red' ? '红' : c === 'Green' ? '绿' : '蓝'}</button>)}
    </div>
  )
}

// MARK: Curves

const IDENTITY: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }]

function Curves() {
  const { adj, change } = useAdjustment()
  const [channel, setChannel] = useState(0)
  const bins = useHistogram()
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)
  const points = adj?.curves?.channels[channel]?.length ? adj.curves.channels[channel] : IDENTITY
  // The points as last set, for pointer events that arrive before the panel re-renders with them.
  const latest = useRef(points)
  latest.current = points
  const path = useMemo(() => {
    let d = ''
    for (let x = 0; x <= 255; x += 2) d += `${x ? 'L' : 'M'}${x},${255 - curveValue(points, x)}`
    return d
  }, [points])
  if (!adj) return null

  const setPoints = (next: CurvePoint[]) => { latest.current = next; change('曲线', (a) => {
    const channels = [0, 1, 2, 3].map((i) => (a.curves?.channels[i]?.length ? a.curves.channels[i] : IDENTITY).map((p) => ({ ...p })))
    channels[channel] = next
    return { ...a, curves: { channel: a.curves?.channel ?? 'RGB', channels } }
  }) }
  const at = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return {
      x: Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))),
      y: Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255))),
    }
  }
  const moveTo = (i: number, p: CurvePoint) => {
    const points = latest.current
    const next = points.map((q) => ({ ...q }))
    // Ends stay at x 0 and 255; the rest keep their order, at least one step apart.
    const x = i === 0 ? 0 : i === points.length - 1 ? 255 : Math.min(points[i + 1].x - 1, Math.max(points[i - 1].x + 1, p.x))
    next[i] = { x, y: p.y }
    setPoints(next)
  }

  return (
    <div className="adjust-body">
      <ChannelPicker value={channel} onChange={setChannel} />
      <svg
        ref={svg} className="curves" viewBox="0 0 255 255" role="img" aria-label="曲线：点击添加点，拖动调整，双击删除"
        onPointerDown={(e) => {
          const p = at(e), points = latest.current
          // A press near a point takes it; elsewhere it adds one there (up to 32, as upstream allows).
          const near = points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 10)
          e.currentTarget.setPointerCapture(e.pointerId)
          if (near >= 0) { dragging.current = near; return }
          if (points.length >= 32 || p.x <= 0 || p.x >= 255 || points.some((q) => q.x === p.x)) return
          const next = [...points, p].sort((a, b) => a.x - b.x)
          dragging.current = next.indexOf(p)
          setPoints(next)
        }}
        onPointerMove={(e) => { if (dragging.current !== null) moveTo(dragging.current, at(e)) }}
        onPointerUp={() => { dragging.current = null; seal() }}
        onDoubleClick={(e) => {
          const p = at(e), current = latest.current
          const near = current.findIndex((q, i) => i > 0 && i < current.length - 1 && Math.hypot(q.x - p.x, q.y - p.y) < 10)
          if (near > 0) { setPoints(current.filter((_, i) => i !== near)); seal() }
        }}
      >
        {bins && <path className="hist" d={histogramPath(bins[channel], 255, 255)} />}
        {[64, 128, 192].map((g) => <g key={g}><line className="grid" x1={g} y1={0} x2={g} y2={255} /><line className="grid" x1={0} y1={g} x2={255} y2={g} /></g>)}
        <line className="diagonal" x1={0} y1={255} x2={255} y2={0} />
        <path className={`curve ch${channel}`} d={path} />
        {points.map((p, i) => <circle key={i} cx={p.x} cy={255 - p.y} r={4} />)}
      </svg>
      <p className="note">点击添加点 · 拖动调整 · 双击删除</p>
    </div>
  )
}

// MARK: Hue/Saturation

type RangeAdjustment = { hue: number; saturation: number; lightness: number }

/** Master range settings, whether the file keeps them flat or (range-aware, from newer desktop builds) in hsvSettings. */
function masterOf(a: Adjustment): RangeAdjustment & { colorize: boolean } {
  const hsv = a.hsvSettings as { colorize?: boolean; adjustments?: unknown } | undefined
  if (hsv) {
    const raw = hsv.adjustments
    let m: Partial<RangeAdjustment> | undefined
    if (Array.isArray(raw)) { const i = raw.indexOf('Master'); m = i >= 0 ? raw[i + 1] : undefined }
    else m = (raw as Record<string, RangeAdjustment> | undefined)?.Master
    return { hue: m?.hue ?? 0, saturation: m?.saturation ?? 0, lightness: m?.lightness ?? 0, colorize: hsv.colorize ?? false }
  }
  return { hue: a.hue ?? 0, saturation: a.saturation ?? 0, lightness: a.lightness ?? 0, colorize: a.colorize ?? false }
}

function withMaster(a: Adjustment, m: RangeAdjustment & { colorize: boolean }): Adjustment {
  const next: Adjustment = { ...a, hue: m.hue, saturation: m.saturation, lightness: m.lightness, colorize: m.colorize }
  const hsv = a.hsvSettings as { colorize?: boolean; adjustments?: unknown; range?: string } | undefined
  if (hsv) {
    const raw = hsv.adjustments
    const master = { hue: m.hue, saturation: m.saturation, lightness: m.lightness }
    let adjustments: unknown
    if (Array.isArray(raw)) {
      const list = [...raw]
      const i = list.indexOf('Master')
      if (i >= 0) list[i + 1] = master
      else list.push('Master', master)
      adjustments = list
    } else adjustments = { ...(raw as object), Master: master }
    // The sliders here edit Master, so Colorize reads Master too.
    next.hsvSettings = { ...hsv, colorize: m.colorize, adjustments, range: 'Master' }
  }
  return next
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="slider-row">
      <NumberField label={label} value={value} min={min} max={max} width={44} onChange={onChange} />
      <input type="range" min={min} max={max} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))} onPointerUp={seal} onKeyUp={seal} />
    </div>
  )
}

function HueSaturation() {
  const { adj, change } = useAdjustment()
  if (!adj) return null
  const m = masterOf(adj)
  const set = (patch: Partial<typeof m>) => change('色相/饱和度', (a) => withMaster(a, { ...masterOf(a), ...patch }))
  return (
    <div className="adjust-body">
      <Slider label="色相" value={m.hue} min={m.colorize ? 0 : -180} max={m.colorize ? 360 : 180} onChange={(hue) => set({ hue })} />
      <Slider label="饱和度" value={m.saturation} min={m.colorize ? 0 : -100} max={100} onChange={(saturation) => set({ saturation })} />
      <Slider label="明度" value={m.lightness} min={-100} max={100} onChange={(lightness) => set({ lightness })} />
      <label className="check">
        <input type="checkbox" checked={m.colorize} onChange={(e) => {
          // Photoshop's starting point when Colorize is switched on: saturation 25 (upstream colorizeStart).
          set(e.target.checked ? { colorize: true, hue: 0, saturation: 25, lightness: 0 } : { colorize: false })
          seal()
        }} /> 着色
      </label>
    </div>
  )
}

// MARK: Exposure

function Exposure() {
  const { adj, change } = useAdjustment()
  if (!adj) return null
  const s = adj.exposureSettings ?? { exposure: 0, offset: 0, gamma: 1 }
  const set = (patch: Partial<typeof s>) => change('曝光度', (a) => ({ ...a, exposureSettings: { ...(a.exposureSettings ?? { exposure: 0, offset: 0, gamma: 1 }), ...patch } }))
  return (
    <div className="adjust-body">
      <NumberField label="曝光度" value={s.exposure} min={-20} max={20} step={0.01} digits={2} width={56} onChange={(exposure) => set({ exposure })} />
      <NumberField label="位移" value={s.offset} min={-0.5} max={0.5} step={0.001} digits={4} width={64} onChange={(offset) => set({ offset })} />
      <NumberField label="灰度系数" value={s.gamma} min={0.01} max={9.99} step={0.01} digits={2} width={56} onChange={(gamma) => set({ gamma })} />
    </div>
  )
}
