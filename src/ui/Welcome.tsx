import { FileArchive, FolderInput, Image } from 'lucide-react'
import { useState } from 'react'
import { openSample, pickFolder, pickZip } from './commands'
import { newCanvas } from './store'

const PRESETS: [string, number, number][] = [
  ['1920 × 1080', 1920, 1080],
  ['1080 × 1350 · 4:5', 1080, 1350],
  ['1080 × 1920 · 9:16', 1080, 1920],
  ['3000 × 2000', 3000, 2000],
  ['4000 × 3000', 4000, 3000],
]

/** What an empty window offers, and what the + button opens: a new canvas, or a project to open. */
export function Welcome({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const [width, setWidth] = useState('1920')
  const [height, setHeight] = useState('1080')
  const w = Number(width), h = Number(height)
  const valid = Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= 30000 && h <= 30000
  const done = (action: () => void) => () => { action(); onDone?.() }

  return (
    <div className={`welcome${compact ? ' compact' : ''}`}>
      {!compact && (
        <div className="welcome-head">
          <h1>Compositor</h1>
          <p>浏览器里的分层合成。图片只在你的电脑上处理，不会上传。</p>
        </div>
      )}
      <section>
        <h2>新建画布</h2>
        <div className="size-row">
          <label>宽 <input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="numeric" /></label>
          <span className="times">×</span>
          <label>高 <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="numeric" /></label>
          <span className="unit">px</span>
          <button className="primary" disabled={!valid} onClick={done(() => newCanvas(w, h))}>创建</button>
        </div>
        <div className="presets">
          {PRESETS.map(([label, pw, ph]) => (
            <button key={label} className={pw === w && ph === h ? 'chip on' : 'chip'} onClick={() => { setWidth(String(pw)); setHeight(String(ph)) }}>
              {label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>打开</h2>
        <div className="open-row">
          <button onClick={done(pickFolder)}><FolderInput size={15} /> .comp 文件夹</button>
          <button onClick={done(pickZip)}><FileArchive size={15} /> zip</button>
          <button onClick={done(openSample)}><Image size={15} /> 示例项目</button>
        </div>
        <p className="note">也可以把 .comp 文件夹或 zip 直接拖进窗口。桌面版保存的项目可以直接打开。</p>
      </section>
    </div>
  )
}
