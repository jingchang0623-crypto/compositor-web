import { useCallback, useEffect, useRef, useState } from 'react'
import { animate, THRESHOLDS, type FrameStats, stats } from '../bench/bench'
import { syntheticProject, warmCurves } from '../bench/synthetic'
import { CanvasRenderer, type FramePath } from '../engine/canvasRenderer'
import { Compositor, type AssetStore, type View } from '../engine/compositor'
import { assetStore, filesFromDrop, filesFromInput, filesFromZip, loadProject, type LoadedProject, type PackageFiles } from '../io/comp'
import { compareWithPreview, type PreviewComparison } from '../io/compare'
import { BLEND_GROUPS, type BlendMode, type LayerRecord, type Manifest } from '../model/manifest'

interface BenchReport {
  document: string
  renderer: string
  canvas: string
  textureMB: number
  uploadMs: number
  /** Display frames, when the page was on screen. */
  navigate: FrameStats | null
  navigateGpu: FrameStats
  adjust: FrameStats | null
  adjustGpu: FrameStats
  pass: { navigate: boolean; adjust: boolean }
}

declare global {
  interface Window {
    __bench?: BenchReport
    __editor?: { project: () => LoadedProject | null; comparison: () => PreviewComparison | null; runBench: () => Promise<void> }
    __debug?: { compositor: Compositor | null; renderer: CanvasRenderer | null; view: () => View; store: () => AssetStore | null; doc: () => Manifest | null }
  }
}

const params = new URLSearchParams(location.search)

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const compositorRef = useRef<Compositor | null>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  /** One store per project, so the renderer can tell a pan from an edit by identity. */
  const storeRef = useRef<AssetStore | null>(null)
  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 })
  const docRef = useRef<Manifest | null>(null)
  const projectRef = useRef<LoadedProject | null>(null)
  const pendingRef = useRef(false)

  const [project, setProject] = useState<LoadedProject | null>(null)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [zoom, setZoom] = useState(1)
  const [frameMs, setFrameMs] = useState(0)
  const [framePath, setFramePath] = useState<FramePath>('screen')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<PreviewComparison | null>(null)
  const [bench, setBench] = useState<BenchReport | null>(null)
  const [dropping, setDropping] = useState(false)
  const [dragging, setDragging] = useState(false)

  // MARK: Drawing

  const draw = useCallback(() => {
    const renderer = rendererRef.current, canvas = canvasRef.current, doc = docRef.current, store = storeRef.current
    if (!renderer || !canvas || !doc || !store) return
    const t0 = performance.now()
    setFramePath(renderer.frame(doc, store, canvas.width, canvas.height, viewRef.current))
    setFrameMs(performance.now() - t0)
  }, [])

  const requestDraw = useCallback(() => {
    if (pendingRef.current) return
    pendingRef.current = true
    requestAnimationFrame(() => {
      pendingRef.current = false
      draw()
    })
  }, [draw])

  const setView = useCallback((view: View) => {
    viewRef.current = view
    setZoom(view.scale)
    requestDraw()
  }, [requestDraw])

  const fitView = useCallback((): View | null => {
    const canvas = canvasRef.current, doc = docRef.current
    if (!canvas || !doc) return null
    const margin = 40 * devicePixelRatio
    const scale = Math.min((canvas.width - margin) / doc.width, (canvas.height - margin) / doc.height)
    return { scale, x: (canvas.width - doc.width * scale) / 2, y: (canvas.height - doc.height * scale) / 2 }
  }, [])

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const v = viewRef.current
    const scale = Math.min(64, Math.max(0.01, v.scale * factor))
    const k = scale / v.scale
    setView({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k })
  }, [setView])

  useEffect(() => {
    const canvas = canvasRef.current!
    try {
      // Development mode runs this effect twice on the same canvas; one compositor serves both.
      compositorRef.current ??= new Compositor(canvas)
      rendererRef.current ??= new CanvasRenderer(compositorRef.current)
      window.__debug = {
        compositor: compositorRef.current, renderer: rendererRef.current,
        view: () => viewRef.current, store: () => storeRef.current, doc: () => docRef.current,
      }
    } catch (e) {
      setError(String(e))
    }
    const resize = () => {
      canvas.width = Math.round(canvas.clientWidth * devicePixelRatio)
      canvas.height = Math.round(canvas.clientHeight * devicePixelRatio)
      requestDraw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    // Photoshop's wheel: scroll pans, and a pinch (or ⌘/⌥ with the wheel) zooms at the pointer.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const cx = (e.clientX - rect.left) * devicePixelRatio, cy = (e.clientY - rect.top) * devicePixelRatio
      if (e.ctrlKey || e.metaKey || e.altKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), cx, cy)
      else {
        const v = viewRef.current
        setView({ ...v, x: v.x - e.deltaX * devicePixelRatio, y: v.y - e.deltaY * devicePixelRatio })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [requestDraw, setView, zoomAt])

  useEffect(() => {
    docRef.current = manifest
    requestDraw()
  }, [manifest, requestDraw])

  // MARK: Opening

  const adopt = useCallback(async (next: LoadedProject) => {
    const compositor = compositorRef.current
    const previous = projectRef.current
    projectRef.current = next
    storeRef.current = assetStore(next.assets)
    docRef.current = next.manifest
    compositor?.retainOnly(new Set(next.assets.values()))
    if (previous && previous !== next)
      for (const source of previous.assets.values()) if ('close' in source) source.close()
    setProject(next)
    setManifest(next.manifest)
    setComparison(null)
    const fit = fitView()
    if (fit) setView(fit)
    if (compositor && next.preview) setComparison(await compareWithPreview(compositor, next))
  }, [fitView, setView])

  const open = useCallback(async (read: () => Promise<PackageFiles>, name: string) => {
    setError(null)
    setBusy('正在读取 .comp …')
    try {
      const files = await read()
      setBusy('正在解码图层 …')
      await adopt(await loadProject(files, name, compositorRef.current?.maxTextureSize ?? 8192))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [adopt])

  // MARK: Benchmark (G0.2 and G0.3)

  const runBench = useCallback(async () => {
    const compositor = compositorRef.current, canvas = canvasRef.current
    if (!compositor || !canvas) return
    setBench(null)
    const layers = Number(params.get('layers') ?? 20), w = Number(params.get('w') ?? 4000), h = Number(params.get('h') ?? 3000)
    const name = `Synthetic ${layers}×${w}×${h}`
    let p = projectRef.current
    if (p?.name !== name) {
      setBusy(`正在生成 ${layers} 层 ${w}×${h} 基准文档 …`)
      await new Promise((r) => setTimeout(r, 30))
      p = await syntheticProject(layers, w, h)
      await adopt(p)
    }
    setBusy('正在上传纹理 …')
    await new Promise((r) => setTimeout(r, 30))
    const t0 = performance.now()
    draw()
    compositor.finish()
    const uploadMs = performance.now() - t0

    const yieldToPage = () => new Promise((r) => setTimeout(r, 0))
    // Display frames only come while the page is on screen; a hidden page is measured by GPU cost alone.
    const visible = document.visibilityState === 'visible'
    // Each frame drawn and then waited out on the GPU: its whole cost, whatever the display's refresh rate. Stricter
    // than display frames, since the CPU and GPU never overlap.
    const synced = async (n: number, frame: (t: number) => void) => {
      const deltas: number[] = []
      for (let i = 0; i < n; i++) {
        const s = performance.now()
        frame(i / n)
        compositor.finish()
        deltas.push(performance.now() - s)
        if (i % 10 === 9) await yieldToPage()
      }
      return stats(deltas, deltas)
    }

    setBusy('基准：平移缩放 …')
    const fit = fitView()!
    const doc = p.manifest
    docRef.current = doc
    const navigateFrame = (t: number) => {
      const zoomK = 1 + 2 * Math.sin(Math.PI * t) ** 2
      const scale = fit.scale * zoomK
      const angle = 2 * Math.PI * t
      const cx = doc.width * (0.5 + 0.25 * Math.cos(angle)), cy = doc.height * (0.5 + 0.25 * Math.sin(angle))
      viewRef.current = { scale, x: canvas.width / 2 - cx * scale, y: canvas.height / 2 - cy * scale }
      draw()
    }
    const navigateGpu = await synced(120, navigateFrame)
    const navigate = visible ? await animate(6000, navigateFrame) : null

    setBusy('基准：拖动曲线参数 …')
    viewRef.current = fit
    const curvesIndex = doc.layers.findIndex((l) => l.adjustment?.kind === 'Curves')
    const adjustFrame = (t: number) => {
      const layers = doc.layers.slice()
      layers[curvesIndex] = { ...layers[curvesIndex], adjustment: warmCurves(Math.round(120 + 70 * Math.sin(2 * Math.PI * t * 3))) }
      docRef.current = { ...doc, layers }
      draw()
    }
    const adjustGpu = await synced(90, adjustFrame)
    const adjust = visible ? await animate(3000, adjustFrame) : null
    docRef.current = doc
    setView(fit)

    const report: BenchReport = {
      document: p.name,
      renderer: compositor.renderer,
      canvas: `${canvas.width}×${canvas.height} (dpr ${devicePixelRatio})`,
      textureMB: Math.round(compositor.textureBytes / 1048576),
      uploadMs: Math.round(uploadMs),
      navigate, navigateGpu, adjust, adjustGpu,
      pass: {
        navigate: navigateGpu.avgMs <= 1000 / THRESHOLDS.navigateFps && navigateGpu.p95Ms <= THRESHOLDS.navigateP95Ms,
        adjust: adjustGpu.p95Ms <= THRESHOLDS.adjustP95Ms,
      },
    }
    window.__bench = report
    setBench(report)
    setBusy(null)
  }, [adopt, draw, fitView, setView])

  useEffect(() => {
    window.__editor = { project: () => projectRef.current, comparison: () => comparison, runBench }
  }, [comparison, runBench])

  // ?open=<url of a zipped .comp>: opens it on load, for links and tests.
  const autoOpen = useRef(false)
  useEffect(() => {
    const url = params.get('open')
    if (!url || autoOpen.current) return
    autoOpen.current = true
    void open(async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${url}: ${response.status}`)
      return filesFromZip(new Uint8Array(await response.arrayBuffer()))
    }, url.split('/').pop() ?? url)
  }, [open])

  const autoBench = useRef(false)
  useEffect(() => {
    if (!params.get('bench') || autoBench.current) return
    autoBench.current = true
    void runBench()
  }, [runBench])

  // MARK: Keys

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const canvas = canvasRef.current
      if (!canvas) return
      if (e.key === '0') {
        const fit = fitView()
        if (fit) setView(fit)
      } else if (e.key === '1') {
        const v = viewRef.current, cx = canvas.width / 2, cy = canvas.height / 2
        zoomAt(1 / v.scale, cx, cy)
      } else if (e.key === '=' || e.key === '+') zoomAt(1.25, canvas.width / 2, canvas.height / 2)
      else if (e.key === '-') zoomAt(0.8, canvas.width / 2, canvas.height / 2)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView, setView, zoomAt])

  // MARK: Layers

  const updateLayer = (id: string, patch: Partial<LayerRecord>) =>
    setManifest((m) => m && { ...m, layers: m.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })

  const depth = (layer: LayerRecord) => {
    let d = 0
    for (let id = layer.parentID; id; id = manifest?.layers.find((l) => l.id === id)?.parentID) d++
    return d
  }

  // MARK: View

  const drag = useRef<{ x: number; y: number } | null>(null)
  return (
    <div className="app">
      <header className="topbar">
        <span className="title">Compositor Web</span>
        <label className="file">
          <button>打开 .comp 文件夹</button>
          <input type="file" {...{ webkitdirectory: '' }} onChange={(e) => {
            const list = e.target.files
            if (list?.length) void open(async () => filesFromInput(list), list[0].webkitRelativePath.split('/')[0])
            e.target.value = ''
          }} />
        </label>
        <label className="file">
          <button>打开 zip</button>
          <input type="file" accept=".zip" onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void open(async () => filesFromZip(new Uint8Array(await file.arrayBuffer())), file.name)
            e.target.value = ''
          }} />
        </label>
        <span className="spacer" />
        <button onClick={() => void runBench()} disabled={!!busy}>运行基准（G0.2 / G0.3）</button>
        <a href="?test=blend"><button>混合模式测试（G0.1）</button></a>
      </header>

      <main
        className={`stage${dropping ? ' drop-target' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDropping(true) }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDropping(false)
          const transfer = e.dataTransfer
          void open(() => filesFromDrop(transfer), transfer.items[0]?.getAsFile()?.name ?? 'Project')
        }}
      >
        <canvas
          ref={canvasRef}
          className={dragging ? 'dragging' : ''}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY }
            setDragging(true)
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            const v = viewRef.current
            const dx = (e.clientX - drag.current.x) * devicePixelRatio, dy = (e.clientY - drag.current.y) * devicePixelRatio
            drag.current = { x: e.clientX, y: e.clientY }
            setView({ ...v, x: v.x + dx, y: v.y + dy })
          }}
          onPointerUp={() => { drag.current = null; setDragging(false) }}
        />
        {!manifest && !busy && (
          <div className="empty">
            <strong>把 .comp 文件夹或 zip 拖到这里</strong>
            <span>或点「运行基准」生成 20 层 4000×3000 的测试文档</span>
          </div>
        )}
        {busy && <div className="busy">{busy}</div>}
      </main>

      <aside className="side">
        {error && <section><h3>错误</h3><p className="fail">{error}</p></section>}
        {bench && <BenchPanel report={bench} />}
        {comparison && (
          <section>
            <h3>与桌面版预览对比（G0.4）</h3>
            <dl className="metrics">
              <dt>PSNR</dt>
              <dd className={comparison.psnr >= 35 ? 'pass' : 'fail'}>{comparison.psnr.toFixed(2)} dB</dd>
              <dt>尺寸</dt><dd>{comparison.width}×{comparison.height}</dd>
            </dl>
          </section>
        )}
        {project && project.warnings.length > 0 && (
          <section>
            <h3>尚未支持</h3>
            <ul className="warnings">{project.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </section>
        )}
        {manifest && (
          <section>
            <h3>图层 · {manifest.layers.length}</h3>
            {[...manifest.layers].reverse().map((layer) => (
              <div className="layer" key={layer.id} style={{ paddingLeft: 4 + depth(layer) * 14 }}>
                <input type="checkbox" checked={layer.isVisible} onChange={(e) => updateLayer(layer.id, { isVisible: e.target.checked })} />
                <div className="name">
                  {layer.isGroup ? '📁 ' : ''}{layer.name}
                  {layer.adjustment && <span className="kind">{layer.adjustment.kind}</span>}
                  {layer.maskFile && <span className="kind">· 蒙版</span>}
                </div>
                <div className="controls">
                  <select value={layer.blendMode ?? 'Normal'} disabled={layer.isGroup}
                    onChange={(e) => updateLayer(layer.id, { blendMode: e.target.value as BlendMode })}>
                    {BLEND_GROUPS.map((group, i) => (
                      <optgroup key={i} label="—">{group.map((m) => <option key={m}>{m}</option>)}</optgroup>
                    ))}
                  </select>
                  <input type="range" min={0} max={100} value={Math.round((layer.opacity ?? 1) * 100)}
                    onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) / 100 })} />
                  <span className="pct">{Math.round((layer.opacity ?? 1) * 100)}%</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </aside>

      <footer className="statusbar">
        <span>{manifest ? `${manifest.width}×${manifest.height} px · v${manifest.version}` : '未打开文档'}</span>
        <span>缩放 {(zoom * 100 / devicePixelRatio).toFixed(1)}%</span>
        <span>帧提交 {frameMs.toFixed(1)} ms · {framePath === 'screen' ? '实时合成' : framePath === 'cache' ? '缓存' : '重建缓存'}</span>
        <span>合成 {compositorRef.current?.lastPasses ?? 0} 次</span>
        <span>纹理 {Math.round((compositorRef.current?.textureBytes ?? 0) / 1048576)} MB</span>
      </footer>
    </div>
  )
}

function BenchPanel({ report }: { report: BenchReport }) {
  const row = (label: string, s: FrameStats | null, gpu: FrameStats) => (
    <>
      <dt>{label} · 每帧（含 GPU）</dt>
      <dd>均 {gpu.avgMs.toFixed(1)} ms · p95 {gpu.p95Ms.toFixed(1)} ms</dd>
      <dt>{label} · 屏幕帧率</dt>
      <dd>{s ? `${s.avgFps.toFixed(1)} fps · p95 ${s.p95Ms.toFixed(1)} ms` : '页面不可见，未测'}</dd>
    </>
  )
  return (
    <section>
      <h3>基准结果</h3>
      <dl className="metrics">
        <dt>文档</dt><dd>{report.document}</dd>
        <dt>GPU</dt><dd>{report.renderer}</dd>
        <dt>画布</dt><dd>{report.canvas}</dd>
        <dt>纹理</dt><dd>{report.textureMB} MB</dd>
        <dt>首帧上传</dt><dd>{report.uploadMs} ms</dd>
        {row('平移缩放', report.navigate, report.navigateGpu)}
        {row('拖曲线', report.adjust, report.adjustGpu)}
        <dt>G0.2</dt><dd className={report.pass.navigate ? 'pass' : 'fail'}>{report.pass.navigate ? '通过' : '未通过'}</dd>
        <dt>G0.3</dt><dd className={report.pass.adjust ? 'pass' : 'fail'}>{report.pass.adjust ? '通过' : '未通过'}</dd>
      </dl>
    </section>
  )
}
