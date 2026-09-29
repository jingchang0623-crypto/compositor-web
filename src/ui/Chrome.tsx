// The window's bars: title bar with tabs, the tool's options bar, the tool rail and the status bar.

import { ArrowLeftRight, Ellipsis, Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { actualPixels, fit, zoomCentered, zoomStep } from './commands'
import { activateTab, activeTab, activeView, closeTab, setTool, useEditor } from './store'
import { IDLE_HINT, TOOLS } from './tools'
import { formatZoom } from './viewport'
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
      {tool === 'move' && (
        <>
          <label className="check"><input type="checkbox" disabled defaultChecked /> 自动选择</label>
          <label className="check"><input type="checkbox" disabled defaultChecked /> 显示变换控件</label>
        </>
      )}
      {def && !def.ready && <span className="soon">G2 实现 · 当前可用：抓手 H、缩放 Z、空格平移</span>}
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
