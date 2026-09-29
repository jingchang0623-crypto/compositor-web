import { ChevronDown, ChevronRight, Contrast, Eye, EyeOff, Folder, FolderPlus, Layers, Sparkles, SquarePlus, Trash2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PixelSource } from '../engine/compositor'
import { BLEND_GROUPS, type BlendMode, type LayerRecord } from '../model/manifest'
import { activeTab, getState, selectLayer, setLayersWidth, toggleCollapsed, updateLayer, useEditor } from './store'

const THUMB = 40

/**
 * Small copies of layer pixels, made once per image, one at a time and never while the editor is busy: reducing a
 * 12-megapixel layer takes long enough to stall a benchmark or an edit if two dozen start at once.
 */
const thumbnails = new WeakMap<object, Promise<ImageBitmap>>()
let queue: Promise<unknown> = Promise.resolve()
const idle = () => new Promise<void>((resolve) => {
  const wait = () => (getState().busy ? setTimeout(wait, 200) : setTimeout(resolve, 16))
  wait()
})
function thumbnail(source: PixelSource): Promise<ImageBitmap> | null {
  if (!(source instanceof ImageBitmap)) return null
  let made = thumbnails.get(source)
  if (!made) {
    const k = Math.min(1, (THUMB * 2) / Math.max(source.width, source.height))
    made = queue.then(idle).then(() => createImageBitmap(source, {
      resizeWidth: Math.max(1, Math.round(source.width * k)), resizeHeight: Math.max(1, Math.round(source.height * k)),
      resizeQuality: 'high',
    }))
    queue = made.catch(() => undefined)
    thumbnails.set(source, made)
  }
  return made
}

function Thumb({ source, mask }: { source: PixelSource | undefined; mask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !source) return
    let live = true
    void thumbnail(source)?.then((bitmap) => {
      if (!live) return
      const g = canvas.getContext('2d')!
      const size = THUMB * 2
      g.clearRect(0, 0, size, size)
      const k = Math.min(size / bitmap.width, size / bitmap.height)
      const w = bitmap.width * k, h = bitmap.height * k
      g.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
    }).catch(() => {}) // Its tab closed before the thumbnail was made.
    return () => { live = false }
  }, [source])
  return <canvas ref={ref} width={THUMB * 2} height={THUMB * 2} className={`thumb${mask ? ' mask' : ''}`} />
}

interface Row {
  layer: LayerRecord
  depth: number
}

export function LayersPanel() {
  const tab = useEditor(activeTab)
  const width = useEditor((s) => s.layersWidth)
  const doc = tab?.doc
  const collapsed = tab?.collapsed

  // Top of the stack first, with each folder's contents under it, skipping collapsed folders.
  const rows = useMemo(() => {
    if (!doc) return []
    const children = new Map<string | undefined, LayerRecord[]>()
    for (const layer of doc.layers) children.set(layer.parentID, [...(children.get(layer.parentID) ?? []), layer])
    const out: Row[] = []
    const walk = (parent: string | undefined, depth: number) => {
      for (const layer of [...(children.get(parent) ?? [])].reverse()) {
        out.push({ layer, depth })
        if (layer.isGroup && !collapsed?.has(layer.id)) walk(layer.id, depth + 1)
      }
    }
    walk(undefined, 0)
    return out
  }, [doc, collapsed])

  const active = doc?.layers.find((l) => l.id === tab?.activeLayerID)
  const opacity = Math.round((active?.opacity ?? 1) * 100)

  const resizing = useRef<{ x: number; width: number } | null>(null)
  const [dragOpacity, setDragOpacity] = useState<string | null>(null)

  return (
    <aside className="layers" style={{ width }}>
      <div
        className="resize-edge"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          resizing.current = { x: e.clientX, width }
        }}
        onPointerMove={(e) => {
          if (resizing.current) setLayersWidth(resizing.current.width - (e.clientX - resizing.current.x))
        }}
        onPointerUp={() => { resizing.current = null }}
      />
      <header className="layers-head">
        <span>图层</span>
        <span className="count">{doc?.layers.length ?? 0}</span>
      </header>

      <div className="appearance">
        <label>
          <span>混合</span>
          <select
            value={active?.blendMode ?? 'Normal'}
            disabled={!active || active.isGroup}
            title={active?.isGroup ? '文件夹是穿透的，混合模式固定为正常' : undefined}
            onChange={(e) => active && updateLayer(active.id, { blendMode: e.target.value as BlendMode })}
          >
            {BLEND_GROUPS.map((group, i) => (
              <optgroup key={i} label={i === 0 ? '' : '—'}>
                {group.map((m) => <option key={m} value={m}>{m}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span>不透明度</span>
          <input
            type="range" min={0} max={100} value={opacity} disabled={!active}
            onChange={(e) => active && updateLayer(active.id, { opacity: Number(e.target.value) / 100 })}
          />
          <input
            className="number" type="text" inputMode="numeric" disabled={!active}
            value={dragOpacity ?? String(opacity)}
            onFocus={(e) => { setDragOpacity(String(opacity)); e.currentTarget.select() }}
            onChange={(e) => setDragOpacity(e.target.value)}
            onBlur={() => {
              const n = Number(dragOpacity)
              if (active && Number.isFinite(n)) updateLayer(active.id, { opacity: Math.min(100, Math.max(0, n)) / 100 })
              setDragOpacity(null)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
          <span className="unit">%</span>
        </label>
      </div>

      <div className="layer-list" role="listbox" aria-label="图层">
        {!doc?.layers.length && (
          <div className="layers-empty">
            <Layers size={26} strokeWidth={1.2} />
            <strong>还没有图层</strong>
            <span>{doc ? '拖入图片或新建空白图层。' : '新建画布或打开项目。'}</span>
          </div>
        )}
        {rows.map(({ layer, depth }, index) => {
          const image = layer.imageFile ? tab!.project.assets.get(layer.imageFile) : undefined
          const mask = layer.maskFile ? tab!.project.assets.get(layer.maskFile) : undefined
          const selected = layer.id === tab?.activeLayerID
          return (
            <div
              key={layer.id}
              role="option"
              aria-selected={selected}
              tabIndex={selected || (!tab?.activeLayerID && index === 0) ? 0 : -1}
              className={`layer-row${selected ? ' selected' : ''}${layer.isVisible ? '' : ' hidden'}`}
              onPointerDown={() => selectLayer(layer.id)}
              onKeyDown={(e) => {
                // Up and down walk the list, as in the desktop app's layer table.
                const to = e.key === 'ArrowUp' ? rows[index - 1] : e.key === 'ArrowDown' ? rows[index + 1] : undefined
                if (to) {
                  e.preventDefault()
                  selectLayer(to.layer.id)
                  ;(e.currentTarget.parentElement?.children[index + (e.key === 'ArrowUp' ? -1 : 1)] as HTMLElement)?.focus()
                }
              }}
            >
              <button
                className="eye" title={layer.isVisible ? '隐藏' : '显示'} aria-label={`${layer.isVisible ? '隐藏' : '显示'} ${layer.name}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => updateLayer(layer.id, { isVisible: !layer.isVisible })}
              >
                {layer.isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <span style={{ width: Math.min(depth, 8) * 18 }} className="indent" />
              {layer.isGroup ? (
                <button
                  className="disclosure" aria-expanded={!collapsed?.has(layer.id)}
                  aria-label={collapsed?.has(layer.id) ? `展开 ${layer.name}` : `折叠 ${layer.name}`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleCollapsed(layer.id)}
                >
                  {collapsed?.has(layer.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
              ) : <span className="disclosure" />}
              <span className="thumb-slot">
                {layer.isGroup ? <Folder size={22} strokeWidth={1.4} />
                  : layer.adjustment ? <SlidersHorizontal size={20} strokeWidth={1.4} />
                  : image ? <Thumb source={image} /> : <span className="thumb blank" />}
              </span>
              {mask && <span className={`thumb-slot${layer.maskEnabled === false ? ' disabled' : ''}`}><Thumb source={mask} mask /></span>}
              <span className="layer-text">
                <span className="layer-name">{layer.name}</span>
                <span className="layer-sub">
                  {layer.isGroup ? '文件夹' : layer.adjustment ? layer.adjustment.kind
                    : image ? `${image.width} × ${image.height}` : '空白'}
                  {(layer.opacity ?? 1) < 1 && ` · ${Math.round((layer.opacity ?? 1) * 100)}%`}
                  {(layer.blendMode ?? 'Normal') !== 'Normal' && ` · ${layer.blendMode}`}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <footer className="layers-foot">
        <button disabled title="新建图层（⇧⌘N）· G2"><SquarePlus size={16} /></button>
        <button disabled title="编组（⌘G）· G2"><FolderPlus size={16} /></button>
        <button disabled title="图层蒙版 · G2"><Contrast size={16} /></button>
        <button disabled title="图层样式 · G4"><Sparkles size={16} /></button>
        <button disabled title="新建调整图层 · G2"><SlidersHorizontal size={16} /></button>
        <span className="spacer" />
        <button disabled title="删除图层 · G2"><Trash2 size={16} /></button>
      </footer>
    </aside>
  )
}
