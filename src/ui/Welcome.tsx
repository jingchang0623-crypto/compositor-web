import { FileArchive, FolderInput, History, Image, ImagePlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { adopt, discardAutosave, listAutosaves, readAutosave, type AutosaveEntry } from '../io/autosave'
import { loadProject } from '../io/comp'
import { engine } from './CanvasView'
import { openSample, pickFolder, pickImages, pickZip } from './commands'
import { getState, newCanvas, openProject, setBusy, setError } from './store'

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
          <button onClick={done(() => void pickFolder())}><FolderInput size={15} /> .comp 文件夹</button>
          <button onClick={done(pickZip)}><FileArchive size={15} /> zip</button>
          <button onClick={done(pickImages)}><ImagePlus size={15} /> 图片</button>
          <button onClick={done(openSample)}><Image size={15} /> 示例项目</button>
        </div>
        <p className="note">也可以把 .comp 文件夹、zip 或图片直接拖进窗口，或粘贴图片（⌘V）。桌面版保存的项目可以直接打开。</p>
      </section>
      {!compact && <Recovery />}
    </div>
  )
}

/** Unsaved work the browser kept: reopen it, or let it go. */
function Recovery() {
  const [entries, setEntries] = useState<AutosaveEntry[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    void listAutosaves().then((list) => {
      // Projects open right now are autosaving themselves, not waiting to be recovered.
      const open = new Set(getState().tabs.map((t) => t.autosaveKey))
      const waiting = list.filter((e) => !open.has(e.key))
      if (!live) return
      setEntries(waiting)
      setUrls(Object.fromEntries(waiting.filter((e) => e.thumbnail).map((e) => [e.key, URL.createObjectURL(e.thumbnail!)])))
    })
    return () => { live = false }
  }, [])
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls])
  if (!entries.length) return null

  const recover = async (e: AutosaveEntry) => {
    setBusy('正在恢复 …')
    try {
      const files = await readAutosave(e.key)
      const project = await loadProject(files, e.name, engine.compositor?.maxTextureSize ?? 8192)
      adopt(e.key, files, project.assets)
      openProject({ ...project, name: e.name, recovered: e.key })
      setEntries((list) => list.filter((x) => x.key !== e.key))
    } catch (err) {
      setError(`无法恢复：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }
  const discard = (e: AutosaveEntry) => {
    void discardAutosave(e.key)
    setEntries((list) => list.filter((x) => x.key !== e.key))
  }
  return (
    <section>
      <h2><History size={13} /> 未保存的工作</h2>
      <ul className="recovery">
        {entries.map((e) => (
          <li key={e.key}>
            {urls[e.key] ? <img src={urls[e.key]} alt="" /> : <span className="thumb" />}
            <span className="info">
              <strong>{e.name}</strong>
              <span>{e.width} × {e.height} · {e.layers} 个图层 · {new Date(e.savedAt).toLocaleString()}</span>
            </span>
            <button className="primary" onClick={() => void recover(e)}>恢复</button>
            <button onClick={() => discard(e)}>丢弃</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
