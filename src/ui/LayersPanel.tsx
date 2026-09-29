import { ChevronDown, ChevronRight, Contrast, Eye, EyeOff, Folder, FolderPlus, Layers, SlidersHorizontal, Sparkles, SquarePlus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PixelSource } from '../engine/compositor'
import { RasterSource } from '../engine/raster'
import { siblingsOf } from '../model/document'
import { BLEND_GROUPS, type AdjustmentKind, type BlendMode, type LayerRecord } from '../model/manifest'
import {
  addAdjustment, addBlankLayer, addFolder, addMask, deleteLayer, deleteMask, moveLayerTo, renameLayer, setBlendMode,
  setOpacity, toggleMaskEnabled, toggleVisibility,
} from './actions'
import { activeTab, getState, seal, selectLayer, setLayersWidth, toggleCollapsed, useEditor } from './store'

const THUMB = 40

/**
 * Small copies of layer pixels, made once per (immutable) source, one at a time and never while the editor is busy:
 * reducing a 12-megapixel layer takes long enough to stall a benchmark or an edit if two dozen start at once.
 */
const thumbnails = new WeakMap<object, Promise<ImageBitmap>>()
let queue: Promise<unknown> = Promise.resolve()
const idle = () => new Promise<void>((resolve) => {
  const wait = () => (getState().busy ? setTimeout(wait, 200) : setTimeout(resolve, 16))
  wait()
})

/** A nearest-pixel reduction of tiles or raw bytes (these have no browser-side image to scale). */
function reduce(source: PixelSource, w: number, h: number, mask: boolean): ImageData {
  const out = new ImageData(w, h)
  const channels = mask ? 1 : 4
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(source.width - 1, Math.floor(((x + 0.5) * source.width) / w))
      const sy = Math.min(source.height - 1, Math.floor(((y + 0.5) * source.height) / h))
      let px: ArrayLike<number> | null, at: number
      if (source instanceof RasterSource) [px, at] = source.pixel(sx, sy)
      else { px = (source as { data: Uint8Array }).data; at = (sy * source.width + sx) * channels }
      const o = (y * w + x) * 4
      if (mask) {
        const v = px ? px[at] : (source as RasterSource).fill
        out.data.set([v, v, v, 255], o)
      } else if (px) {
        const a = px[at + 3]
        // Premultiplied to straight, as ImageData holds it.
        out.data.set(a ? [px[at] * 255 / a, px[at + 1] * 255 / a, px[at + 2] * 255 / a, a] : [0, 0, 0, 0], o)
      }
    }
  return out
}

function thumbnail(source: PixelSource, mask: boolean): Promise<ImageBitmap> | null {
  if ('texture' in source) return null // Still being painted; the thumbnail follows when the stroke ends.
  let made = thumbnails.get(source)
  if (!made) {
    const k = Math.min(1, (THUMB * 2) / Math.max(source.width, source.height))
    const w = Math.max(1, Math.round(source.width * k)), h = Math.max(1, Math.round(source.height * k))
    made = queue.then(idle).then(() => source instanceof ImageBitmap
      ? createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      : createImageBitmap(reduce(source, w, h, mask)))
    queue = made.catch(() => undefined)
    thumbnails.set(source, made)
  }
  return made
}

function Thumb({ source, mask, width, height }: { source: PixelSource | undefined; mask?: boolean; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !source) return
    let live = true
    void thumbnail(source, !!mask)?.then((bitmap) => {
      if (!live) return
      const g = canvas.getContext('2d')!
      const size = THUMB * 2
      g.clearRect(0, 0, size, size)
      // Drawn in the layer's own proportions, so a 1×1 mask fills the box like the layer it covers.
      const k = Math.min(size / width, size / height)
      const w = width * k, h = height * k
      g.imageSmoothingEnabled = bitmap.width > 2
      g.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
    }).catch(() => {}) // Its tab closed before the thumbnail was made.
    return () => { live = false }
  }, [source, mask, width, height])
  return <canvas ref={ref} width={THUMB * 2} height={THUMB * 2} className={`thumb${mask ? ' mask' : ''}`} />
}

interface Row {
  layer: LayerRecord
  depth: number
}

type Drop = { id: string; where: 'above' | 'below' | 'into' }

const ADJUSTMENTS: AdjustmentKind[] = ['Levels', 'Curves', 'Hue/Saturation', 'Exposure', 'Invert']

export function LayersPanel() {
  const tab = useEditor(activeTab)
  const width = useEditor((s) => s.layersWidth)
  const doc = tab?.doc
  const collapsed = tab?.collapsed

  // Top of the stack first, with each folder's contents under it, skipping collapsed folders.
  const rows = useMemo(() => {
    if (!doc) return []
    const out: Row[] = []
    const walk = (parent: string | undefined, depth: number) => {
      for (const layer of [...siblingsOf(doc.layers, parent)].reverse()) {
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
  const [opacityText, setOpacityText] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [adjustMenu, setAdjustMenu] = useState(false)

  const dropAt = (e: React.DragEvent, layer: LayerRecord): Drop => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = (e.clientY - r.top) / r.height
    if (layer.isGroup && t > 0.3 && t < 0.7) return { id: layer.id, where: 'into' }
    return { id: layer.id, where: t < 0.5 ? 'above' : 'below' }
  }

  const finishDrop = (target: Drop) => {
    const moving = dragging
    setDragging(null)
    setDrop(null)
    if (!doc || !moving || moving === target.id) return
    const layer = doc.layers.find((l) => l.id === target.id)!
    // Just below an open folder's header means on top of its contents.
    const opensDown = target.where === 'below' && layer.isGroup && !collapsed?.has(layer.id)
    if (target.where === 'into' || opensDown) {
      return moveLayerTo(moving, layer.id, siblingsOf(doc.layers, layer.id).filter((l) => l.id !== moving).length)
    }
    const siblings = siblingsOf(doc.layers, layer.parentID).filter((l) => l.id !== moving)
    const at = siblings.findIndex((l) => l.id === layer.id)
    moveLayerTo(moving, layer.parentID, target.where === 'above' ? at + 1 : at)
  }

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
            onChange={(e) => active && setBlendMode(active.id, e.target.value as BlendMode)}
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
            onChange={(e) => active && setOpacity(active.id, Number(e.target.value) / 100)}
            // One drag, one undo step.
            onPointerUp={seal} onKeyUp={seal} onBlur={seal}
          />
          <input
            className="number" type="text" inputMode="numeric" disabled={!active}
            value={opacityText ?? String(opacity)}
            onFocus={(e) => { setOpacityText(String(opacity)); e.currentTarget.select() }}
            onChange={(e) => setOpacityText(e.target.value)}
            onBlur={() => {
              const n = Number(opacityText)
              if (active && opacityText !== null && Number.isFinite(n) && n !== opacity) { setOpacity(active.id, n / 100); seal() }
              setOpacityText(null)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
          <span className="unit">%</span>
        </label>
      </div>

      <div className="layer-list" role="listbox" aria-label="图层" onDragLeave={(e) => { if (e.currentTarget === e.target) setDrop(null) }}>
        {!doc?.layers.length && (
          <div className="layers-empty">
            <Layers size={26} strokeWidth={1.2} />
            <strong>还没有图层</strong>
            <span>{doc ? '拖入图片，或新建空白图层。' : '新建画布或打开项目。'}</span>
          </div>
        )}
        {rows.map(({ layer, depth }, index) => {
          const image = layer.imageFile ? tab!.assets.get(layer.imageFile) : undefined
          const mask = layer.maskFile ? tab!.assets.get(layer.maskFile) : undefined
          const selected = layer.id === tab?.activeLayerID
          const onMask = selected && tab?.target === 'mask'
          const [lw, lh] = layer.transform.size
          const dropClass = drop?.id === layer.id ? ` drop-${drop.where}` : ''
          return (
            <div
              key={layer.id}
              role="option"
              aria-selected={selected}
              tabIndex={selected || (!tab?.activeLayerID && index === 0) ? 0 : -1}
              className={`layer-row${selected ? ' selected' : ''}${layer.isVisible ? '' : ' hidden'}${dragging === layer.id ? ' dragging' : ''}${dropClass}`}
              draggable={renaming !== layer.id}
              onDragStart={(e) => { setDragging(layer.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-layer', layer.id) }}
              onDragEnd={() => { setDragging(null); setDrop(null) }}
              onDragOver={(e) => { if (!dragging) return; e.preventDefault(); e.stopPropagation(); setDrop(dropAt(e, layer)) }}
              onDrop={(e) => { if (!dragging) return; e.preventDefault(); e.stopPropagation(); finishDrop(dropAt(e, layer)) }}
              onPointerDown={() => { if (!selected) selectLayer(layer.id) }}
              onKeyDown={(e) => {
                if (renaming) return
                // Up and down walk the list, as in the desktop app's layer table.
                const to = e.key === 'ArrowUp' ? rows[index - 1] : e.key === 'ArrowDown' ? rows[index + 1] : undefined
                if (to) {
                  e.preventDefault()
                  selectLayer(to.layer.id)
                  ;(e.currentTarget.parentElement?.children[index + (e.key === 'ArrowUp' ? -1 : 1)] as HTMLElement)?.focus()
                } else if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
                  e.preventDefault()
                  deleteLayer(layer.id)
                } else if (e.key === 'Enter' && selected) {
                  e.preventDefault()
                  setRenaming(layer.id)
                }
              }}
            >
              <button
                className="eye" title={layer.isVisible ? '隐藏' : '显示'} aria-label={`${layer.isVisible ? '隐藏' : '显示'} ${layer.name}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggleVisibility(layer.id)}
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
              <span
                className={`thumb-slot${selected && !onMask && !layer.isGroup ? ' target' : ''}`}
                title={layer.imageFile ? '编辑图像像素' : undefined}
                onPointerDown={(e) => { e.stopPropagation(); selectLayer(layer.id, 'image') }}
              >
                {layer.isGroup ? <Folder size={22} strokeWidth={1.4} />
                  : layer.adjustment ? <SlidersHorizontal size={20} strokeWidth={1.4} />
                  : image ? <Thumb source={image} width={lw} height={lh} /> : <span className="thumb blank" />}
              </span>
              {layer.maskFile && (
                <span
                  className={`thumb-slot${layer.maskEnabled === false ? ' disabled' : ''}${onMask ? ' target' : ''}`}
                  title="编辑蒙版 · Shift 点击停用/启用"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (e.shiftKey) toggleMaskEnabled(layer.id)
                    else selectLayer(layer.id, 'mask')
                  }}
                >
                  <Thumb source={mask} mask width={lw} height={lh} />
                </span>
              )}
              <span className="layer-text">
                {renaming === layer.id ? (
                  <input
                    className="rename" autoFocus defaultValue={layer.name} aria-label="图层名称"
                    onPointerDown={(e) => e.stopPropagation()}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => { renameLayer(layer.id, e.currentTarget.value); setRenaming(null) }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="layer-name" onDoubleClick={() => setRenaming(layer.id)} title="双击重命名">{layer.name}</span>
                )}
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
        <button disabled={!doc} onClick={addBlankLayer} title="新建图层（⌥⇧⌘N）" aria-label="新建图层"><SquarePlus size={16} /></button>
        <button disabled={!doc} onClick={addFolder} title="新建文件夹 · 选中图层后 ⌘G 编组" aria-label="新建文件夹"><FolderPlus size={16} /></button>
        <button
          disabled={!active || active.isGroup}
          onClick={() => (active?.maskFile ? deleteMask() : addMask())}
          title={active?.maskFile ? '删除蒙版' : '添加蒙版'} aria-label={active?.maskFile ? '删除蒙版' : '添加蒙版'}
        ><Contrast size={16} /></button>
        <button disabled title="图层样式 · G4"><Sparkles size={16} /></button>
        <span className="popover-anchor up">
          <button disabled={!doc} onClick={() => setAdjustMenu((o) => !o)} title="新建调整图层" aria-label="新建调整图层"><SlidersHorizontal size={16} /></button>
          {adjustMenu && (
            <div className="popover menu-pop">
              <div className="menu">
                {ADJUSTMENTS.map((k) => (
                  <button key={k} onClick={() => { setAdjustMenu(false); addAdjustment(k) }}>{k}</button>
                ))}
              </div>
            </div>
          )}
        </span>
        <span className="spacer" />
        <button disabled={!active} onClick={() => deleteLayer()} title="删除图层" aria-label="删除图层"><Trash2 size={16} /></button>
      </footer>
    </aside>
  )
}
