// The window's bars: title bar with tabs, the tool's options bar, the tool rail and the status bar.

import { ArrowLeftRight, Ellipsis, Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addAdjustment, addBlankLayer, addFolder, addMask, deleteLayer, deleteMask, duplicateLayer, groupActive, ungroupActive } from './actions'
import { actualPixels, downloadZip, exportImage, fit, pickFolder, pickImages, pickZip, save, zoomCentered, zoomStep } from './commands'
import { deselect, inverseSelection, selectAllCanvas } from './selectionActions'
import { activateTab, activeLayer, activeTab, activeView, closeTab, redo, setTool, undo, useEditor } from './store'
import { IDLE_HINT, TOOLS } from './tools'
import { formatZoom } from './viewport'
import { BrushOptions, MarqueeOptions, MoveOptions } from './ToolOptions'
import { Welcome } from './Welcome'

// MARK: Title bar

export function TitleBar({ onBench }: { onBench: () => void }) {
  const tabs = useEditor((s) => s.tabs)
  const activeID = useEditor((s) => s.activeTabID)
  const hasDoc = !!activeID
  const [newOpen, setNewOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="titlebar">
      <span className="brand">Compositor</span>
      <MenuBar />
      <div className="popover-anchor">
        <button className="icon" title="新建画布或打开项目" onClick={() => setNewOpen((o) => !o)}><Plus size={16} /></button>
        {newOpen && (
          <Popover onClose={() => setNewOpen(false)}>
            <Welcome compact onDone={() => setNewOpen(false)} />
          </Popover>
        )}
      </div>
      <nav className="tabs" role="tablist" aria-label="项目">
        {tabs.map((t) => (
          <div
            key={t.id} role="tab" tabIndex={t.id === activeID ? 0 : -1} aria-selected={t.id === activeID}
            className={`tab${t.id === activeID ? ' active' : ''}`} title={t.name}
            onPointerDown={() => activateTab(t.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === t.id)
              const next = e.key === 'ArrowRight' ? tabs[i + 1] : e.key === 'ArrowLeft' ? tabs[i - 1] : undefined
              if (next) {
                activateTab(next.id)
                ;(e.currentTarget.parentElement?.children[i + (e.key === 'ArrowRight' ? 1 : -1)] as HTMLElement)?.focus()
              }
            }}
          >
            <span className="tab-name">{t.name}</span>
            {t.history.isModified && <span className="edited" title="有未保存的改动" aria-label="有未保存的改动">•</span>}
            <button className="tab-close" title={`关闭 ${t.name}`} aria-label={`关闭 ${t.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => closeTab(t.id)}>
              <X size={12} />
            </button>
          </div>
        ))}
      </nav>
      <div className="title-actions">
        <button disabled={!hasDoc} onClick={fit} title="适配窗口（⌘0）">适配</button>
        <button disabled={!hasDoc} onClick={actualPixels} title="实际像素（⌘1）">100%</button>
        <button className="icon" disabled={!hasDoc} onClick={() => zoomStep(1)} title="放大（⌘+）"><ZoomIn size={16} /></button>
        <button className="icon" disabled={!hasDoc} onClick={() => zoomStep(-1)} title="缩小（⌘−）"><ZoomOut size={16} /></button>
        <div className="popover-anchor">
          <button className="icon" title="更多" onClick={() => setMenuOpen((o) => !o)}><Ellipsis size={16} /></button>
          {menuOpen && (
            <Popover onClose={() => setMenuOpen(false)} align="right">
              <div className="menu">
                <button onClick={() => { setMenuOpen(false); onBench() }}>运行性能基准（G0.2 / G0.3）</button>
                <a href="?test=blend">渲染自检（G0.1）</a>
                <a href="https://github.com/robbietilton/Compositor" target="_blank" rel="noreferrer">桌面版 Compositor ↗</a>
              </div>
            </Popover>
          )}
        </div>
      </div>
    </header>
  )
}

interface MenuItem {
  label: string
  keys?: string
  run?: () => void
  disabled?: boolean
}
type MenuEntry = MenuItem | 'separator'

/** The desktop app's menus, in a row: File, Edit, Layer, Select. */
function MenuBar() {
  const tab = useEditor(activeTab)
  const layer = useEditor(activeLayer)
  const [open, setOpen] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !(e.target instanceof HTMLInputElement)) setShowKeys((v) => !v)
      if (e.key === 'Escape') setShowKeys(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const doc = !!tab
  const menus: [string, MenuEntry[]][] = [
    ['文件', [
      { label: '打开 .comp 文件夹…', keys: '⌘O', run: () => void pickFolder() },
      { label: '打开 zip…', run: pickZip },
      { label: '打开图片…', keys: '⇧⌘O', run: pickImages },
      'separator',
      { label: '保存', keys: '⌘S', run: () => void save(), disabled: !doc },
      { label: '另存为…', keys: '⇧⌘S', run: () => void save(true), disabled: !doc },
      { label: '下载 .comp（zip）', run: () => void downloadZip(), disabled: !doc },
      'separator',
      { label: '导出 PNG', run: () => void exportImage('image/png'), disabled: !doc },
      { label: '导出 JPEG', keys: '⇧⌥⌘S', run: () => void exportImage('image/jpeg'), disabled: !doc },
      'separator',
      { label: '关闭', run: () => tab && closeTab(tab.id), disabled: !doc },
    ]],
    ['编辑', [
      { label: tab?.history.canUndo ? `撤销${tab.history.undoName}` : '撤销', keys: '⌘Z', run: undo, disabled: !tab?.history.canUndo },
      { label: tab?.history.canRedo ? `重做${tab.history.redoName}` : '重做', keys: '⇧⌘Z', run: redo, disabled: !tab?.history.canRedo },
    ]],
    ['图层', [
      { label: '新建图层', keys: '⌥⇧⌘N', run: addBlankLayer, disabled: !doc },
      { label: '新建文件夹', run: addFolder, disabled: !doc },
      { label: '复制图层', keys: '⌘J', run: () => duplicateLayer(), disabled: !layer },
      { label: '删除图层', run: () => deleteLayer(), disabled: !layer },
      'separator',
      { label: '编组', keys: '⌘G', run: groupActive, disabled: !layer },
      { label: '取消编组', keys: '⇧⌘G', run: ungroupActive, disabled: !layer?.isGroup },
      'separator',
      { label: layer?.maskFile ? '删除蒙版' : '添加蒙版', run: () => (layer?.maskFile ? deleteMask() : addMask()), disabled: !layer || layer.isGroup },
      'separator',
      ...(['Levels', 'Curves', 'Hue/Saturation', 'Exposure', 'Invert'] as const).map((k) => ({ label: `新建调整图层：${k}`, run: () => addAdjustment(k), disabled: !doc })),
    ]],
    ['选择', [
      { label: '全选', keys: '⌘A', run: selectAllCanvas, disabled: !doc },
      { label: '取消选择', keys: '⌘D', run: deselect, disabled: !tab?.selection },
      { label: '反选', keys: '⇧⌘I', run: inverseSelection, disabled: !tab?.selection },
    ]],
    ['帮助', [
      { label: '快捷键', keys: '?', run: () => setShowKeys(true) },
    ]],
  ]
  return (
    <>
    {showKeys && <ShortcutSheet onClose={() => setShowKeys(false)} />}
    <nav className="menubar" aria-label="菜单">
      {menus.map(([name, items]) => (
        <div key={name} className="popover-anchor" onPointerEnter={() => open && setOpen(name)}>
          <button className={`menu-title${open === name ? ' open' : ''}`} onClick={() => setOpen(open === name ? null : name)} aria-haspopup="menu" aria-expanded={open === name}>
            {name}
          </button>
          {open === name && (
            <Popover onClose={() => setOpen(null)}>
              <div className="menu" role="menu">
                {items.map((item, i) => item === 'separator' ? <hr key={i} /> : (
                  <button key={item.label} role="menuitem" disabled={item.disabled} onClick={() => { setOpen(null); item.run?.() }}>
                    <span>{item.label}</span>
                    {item.keys && <kbd>{item.keys}</kbd>}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>
      ))}
    </nav>
    </>
  )
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['工具', [['V', '移动 / 变换'], ['M', '选框'], ['B', '画笔'], ['E', '橡皮'], ['H', '抓手'], ['Z', '缩放'], ['A', '不选工具'], ['空格（按住）', '临时平移']]],
  ['文件', [['⌘O', '打开 .comp 文件夹'], ['⇧⌘O', '打开图片'], ['⌘V', '粘贴图片为新图层'], ['⌘S', '保存'], ['⇧⌘S', '另存为'], ['⇧⌥⌘S', '导出 JPEG']]],
  ['编辑与图层', [['⌘Z / ⇧⌘Z', '撤销 / 重做'], ['⌥⇧⌘N', '新建图层'], ['⌘J', '复制图层'], ['⌘G / ⇧⌘G', '编组 / 取消编组'], ['⌫（图层面板）', '删除图层'], ['Enter（图层面板）', '重命名'], ['↑ ↓（图层面板）', '切换图层']]],
  ['选区', [['⌘A / ⌘D', '全选 / 取消选择'], ['⇧⌘I', '反选'], ['⌫', '清除选区内像素'], ['⌥⌫ / ⌘⌫', '填充前景色 / 背景色'], ['Shift / Option 拖动', '加选 / 减选']]],
  ['画笔', [['[ ]', '大小 ×1.2'], ['Shift + [ ]', '硬度 ±25%'], ['1 … 0', '不透明度 10% … 100%'], ['X / D', '交换 / 默认颜色'], ['Shift 点击', '接着上一笔画直线'], ['Esc', '取消这一笔']]],
  ['视图', [['⌘0 / ⌘1', '适配窗口 / 100%'], ['⌘+ / ⌘−', '放大 / 缩小'], ['⌘ / ⌥ + 滚轮', '缩放'], ['方向键', '微移 1px（Shift 10px）']]],
]

/** Every shortcut on one sheet; Chrome keeps ⌘N, ⌘T and ⌘W for itself, so new layers are ⌥⇧⌘N. */
function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <section className="sheet" role="dialog" aria-label="快捷键" onPointerDown={(e) => e.stopPropagation()}>
        <header><strong>快捷键</strong><button className="icon" onClick={onClose} aria-label="关闭"><X size={14} /></button></header>
        <div className="shortcut-grid">
          {SHORTCUTS.map(([group, rows]) => (
            <div key={group}>
              <h3>{group}</h3>
              <dl>{rows.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
            </div>
          ))}
        </div>
        <p className="note">浏览器保留了 ⌘N、⌘T、⌘W，所以新建图层用 ⌥⇧⌘N。</p>
      </section>
    </div>
  )
}

function Popover({ children, onClose, align }: { children: React.ReactNode; onClose: () => void; align?: 'right' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc) }
  }, [onClose])
  return <div ref={ref} className={`popover${align === 'right' ? ' right' : ''}`}>{children}</div>
}

// MARK: Options bar

export function OptionsBar() {
  const tool = useEditor((s) => s.tool)
  const def = TOOLS.find((t) => t.id === tool)
  return (
    <div className="optionsbar">
      <span className="tool-title">{def?.name.split(' · ')[0] ?? '选择一个工具'}</span>
      {(tool === 'hand' || tool === 'zoom') && <ZoomField />}
      {(tool === 'hand' || tool === 'zoom') && (
        <>
          <button onClick={fit}>适配窗口</button>
          <button onClick={actualPixels}>100%</button>
        </>
      )}
      {tool === 'move' && <MoveOptions />}
      {tool === 'brush' && <BrushOptions />}
      {tool === 'marquee' && <MarqueeOptions />}
      {def && !def.ready && <span className="soon">后续版本 · 现在可用：移动 V、选框 M、画笔 B / 橡皮 E、抓手 H、缩放 Z</span>}
    </div>
  )
}

function ZoomField() {
  const zoom = useEditor((s) => activeView(s)?.view.scale)
  const [text, setText] = useState<string | null>(null)
  if (zoom === undefined) return null
  return (
    <label className="zoom-field">
      <input
        value={text ?? formatZoom(zoom)}
        onFocus={(e) => { setText(formatZoom(zoom)); e.currentTarget.select() }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = parseFloat(text ?? '')
          if (Number.isFinite(n) && n > 0) zoomCentered(n / 100)
          setText(null)
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    </label>
  )
}

// MARK: Tool rail

export function ToolRail() {
  const tool = useEditor((s) => s.tool)
  return (
    <nav className="toolrail" aria-label="工具">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool${tool === t.id ? ' active' : ''}${t.ready ? '' : ' later'}`}
          title={`${t.name}（${t.key}）${t.ready ? '' : ' · G2'}`}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
          // As in Photoshop: double-click the hand to fit, the zoom tool for actual pixels.
          onDoubleClick={() => (t.id === 'hand' ? fit() : t.id === 'zoom' ? actualPixels() : undefined)}
        >
          <t.icon size={17} strokeWidth={1.7} />
        </button>
      ))}
      <div className="swatches" title="前景色 / 背景色 · G2">
        <span className="swatch fg" />
        <span className="swatch bg" />
        <ArrowLeftRight className="swap" size={10} />
      </div>
    </nav>
  )
}

// MARK: Status bar

export function StatusBar() {
  const zoom = useEditor((s) => activeView(s)?.view.scale)
  const tab = useEditor(activeTab)
  const tool = useEditor((s) => s.tool)
  const busy = useEditor((s) => s.busy)
  const [showWarnings, setShowWarnings] = useState(false)
  const warnings = tab?.project.warnings ?? []
  const comparison = tab?.comparison
  return (
    <footer className="statusbar">
      {tab ? (
        <>
          <span className="zoom">{zoom !== undefined ? formatZoom(zoom) : ''}</span>
          <span>{tab.doc.width} × {tab.doc.height} px</span>
          <span>sRGB · 透明</span>
          {comparison && (
            <span className={comparison.psnr >= 35 ? 'pass' : 'fail'} title="与桌面版 QuickLook 预览图的 PSNR（G0.4，≥ 35 dB 通过）">
              对照桌面版 {comparison.psnr.toFixed(1)} dB
            </span>
          )}
          {warnings.length > 0 && (
            <span className="popover-anchor up">
              <button className="link warn" onClick={() => setShowWarnings((s) => !s)}>{warnings.length} 项尚未支持</button>
              {showWarnings && (
                <Popover onClose={() => setShowWarnings(false)}>
                  <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </Popover>
              )}
            </span>
          )}
        </>
      ) : <span>准备就绪</span>}
      <span className="spacer" />
      <span className="hint">{busy ?? (TOOLS.find((t) => t.id === tool)?.hint ?? IDLE_HINT)}</span>
    </footer>
  )
}
