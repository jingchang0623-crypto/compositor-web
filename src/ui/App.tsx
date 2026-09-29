import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FrameStats } from '../bench/bench'
import { runBench, type BenchReport } from '../bench/runBench'
import { CanvasView } from './CanvasView'
import { OptionsBar, StatusBar, TitleBar, ToolRail } from './Chrome'
import { importImages, openDrop, openURL } from './commands'
import { watchAutosave } from './autosaveWatcher'
import { handleKey } from './keys'
import { AdjustmentPanel } from './AdjustmentPanel'
import { LayersPanel } from './LayersPanel'
import { Overlay } from './Overlay'
import { setError, useEditor } from './store'
import { Welcome } from './Welcome'

const params = new URLSearchParams(location.search)

export function App() {
  const hasTabs = useEditor((s) => s.tabs.length > 0)
  const busy = useEditor((s) => s.busy)
  const error = useEditor((s) => s.error)
  const notice = useEditor((s) => s.notice)
  const [dropping, setDropping] = useState(false)
  const [bench, setBench] = useState<BenchReport | null>(null)

  const bench$ = useCallback(async () => {
    setBench(null)
    try {
      setBench(await runBench(Number(params.get('layers') ?? 20), Number(params.get('w') ?? 4000), Number(params.get('h') ?? 3000)))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  // ?open=<zip url> opens a project, ?bench=1 runs the benchmark: for links and tests.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    watchAutosave()
    const url = params.get('open')
    if (url) openURL(url)
    if (params.get('bench')) void bench$()
  }, [bench$])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    // Paste an image as a new layer above the active one.
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      void importImages(files, undefined, true)
    }
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  return (
    <div
      className="app"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false) }}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        if (e.dataTransfer.types.includes('text/x-layer')) return // A layer dragged in the panel, dropped elsewhere.
        openDrop(e.dataTransfer, e.clientX, e.clientY)
      }}
    >
      <TitleBar onBench={() => void bench$()} />
      <OptionsBar />
      <div className="workspace">
        <ToolRail />
        <main className="stage">
          <CanvasView />
          <Overlay />
          <AdjustmentPanel />
          {!hasTabs && !busy && <div className="welcome-wrap"><Welcome /></div>}
          {busy && <div className="busy">{busy}</div>}
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button className="icon" onClick={() => setError(null)} title="关闭"><X size={14} /></button>
            </div>
          )}
          {bench && <BenchCard report={bench} onClose={() => setBench(null)} />}
          {notice && <div className="notice" role="status">{notice}</div>}
          {dropping && <div className="drop-target">松开以打开 .comp，或把图片放进画布</div>}
        </main>
        <LayersPanel />
      </div>
      <StatusBar />
    </div>
  )
}

function BenchCard({ report, onClose }: { report: BenchReport; onClose: () => void }) {
  const row = (label: string, display: FrameStats | null, gpu: FrameStats) => (
    <>
      <dt>{label} · 每帧含 GPU</dt>
      <dd>均 {gpu.avgMs.toFixed(1)} ms · p95 {gpu.p95Ms.toFixed(1)} ms</dd>
      <dt>{label} · 屏幕帧率</dt>
      <dd>{display ? `${display.avgFps.toFixed(1)} fps · p95 ${display.p95Ms.toFixed(1)} ms` : '页面不可见，未测'}</dd>
    </>
  )
  return (
    <section className="card bench">
      <header>
        <strong>性能基准</strong>
        <button className="icon" onClick={onClose} title="关闭"><X size={14} /></button>
      </header>
      <dl className="metrics">
        <dt>文档</dt><dd>{report.document}</dd>
        <dt>GPU</dt><dd>{report.renderer}</dd>
        <dt>画布</dt><dd>{report.canvas}</dd>
        <dt>纹理</dt><dd>{report.textureMB} MB · 首帧上传 {report.uploadMs} ms</dd>
        {row('平移缩放', report.navigate, report.navigateGpu)}
        {row('拖曲线', report.adjust, report.adjustGpu)}
        <dt>G0.2 平移缩放</dt><dd className={report.pass.navigate ? 'pass' : 'fail'}>{report.pass.navigate ? '通过' : '未通过'}</dd>
        <dt>G0.3 调整预览</dt><dd className={report.pass.adjust ? 'pass' : 'fail'}>{report.pass.adjust ? '通过' : '未通过'}</dd>
      </dl>
    </section>
  )
}
