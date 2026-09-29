// G0.2 / G0.3 inside the editor: the same canvas, renderer and state the person uses.

import { engine } from '../ui/CanvasView'
import { activeTab, openProject, replaceDoc, setBusy, setView } from '../ui/store'
import { fitView } from '../ui/viewport'
import { animate, stats, THRESHOLDS, type FrameStats } from './bench'
import { syntheticProject, warmCurves } from './synthetic'

export interface BenchReport {
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
  }
}

const pause = () => new Promise((r) => setTimeout(r, 0))

export async function runBench(layers = 20, width = 4000, height = 3000): Promise<BenchReport> {
  const { compositor, canvas } = engine
  if (!compositor || !canvas) throw new Error('The canvas is not ready.')
  try {
    const name = `Synthetic ${layers}×${width}×${height}`
    let tab = activeTab()
    if (tab?.project.name !== name) {
      setBusy(`正在生成 ${layers} 层 ${width}×${height} 基准文档 …`)
      await new Promise((r) => setTimeout(r, 30))
      tab = openProject(await syntheticProject(layers, width, height))
    }
    const doc = tab.doc
    const fit = fitView(canvas.width, canvas.height, devicePixelRatio, doc)
    setBusy('正在上传纹理 …')
    await pause()
    setView(fit, true)
    const t0 = performance.now()
    engine.drawNow()
    compositor.finish()
    const uploadMs = performance.now() - t0

    // Each frame drawn and waited out on the GPU: its whole cost whatever the display's refresh rate, and stricter
    // than display frames, since the CPU and GPU never overlap.
    const synced = async (n: number, frame: (t: number) => void) => {
      const deltas: number[] = []
      for (let i = 0; i < n; i++) {
        const s = performance.now()
        frame(i / n)
        compositor.finish()
        deltas.push(performance.now() - s)
        if (i % 10 === 9) await pause()
      }
      return stats(deltas, deltas)
    }
    const visible = document.visibilityState === 'visible'

    setBusy('基准：平移缩放 …')
    const navigateFrame = (t: number) => {
      const scale = fit.scale * (1 + 2 * Math.sin(Math.PI * t) ** 2)
      const angle = 2 * Math.PI * t
      const cx = doc.width * (0.5 + 0.25 * Math.cos(angle)), cy = doc.height * (0.5 + 0.25 * Math.sin(angle))
      setView({ scale, x: canvas.width / 2 - cx * scale, y: canvas.height / 2 - cy * scale })
      engine.drawNow()
    }
    const navigateGpu = await synced(200, navigateFrame)
    const navigate = visible ? await animate(6000, navigateFrame) : null

    setBusy('基准：拖动曲线参数 …')
    setView(fit, true)
    const curvesIndex = doc.layers.findIndex((l) => l.adjustment?.kind === 'Curves')
    const adjustFrame = (t: number) => {
      const edited = doc.layers.slice()
      edited[curvesIndex] = { ...edited[curvesIndex], adjustment: warmCurves(Math.round(120 + 70 * Math.sin(2 * Math.PI * t * 3))) }
      replaceDoc({ ...doc, layers: edited })
      engine.drawNow()
    }
    const adjustGpu = await synced(200, adjustFrame)
    const adjust = visible ? await animate(3000, adjustFrame) : null
    replaceDoc(doc)
    setView(fit, true)

    const report: BenchReport = {
      document: name,
      renderer: compositor.renderer,
      canvas: `${canvas.width}×${canvas.height}（dpr ${devicePixelRatio}）`,
      textureMB: Math.round(compositor.textureBytes / 1048576),
      uploadMs: Math.round(uploadMs),
      navigate, navigateGpu, adjust, adjustGpu,
      pass: {
        navigate: navigateGpu.avgMs <= 1000 / THRESHOLDS.navigateFps && navigateGpu.p95Ms <= THRESHOLDS.navigateP95Ms,
        adjust: adjustGpu.p95Ms <= THRESHOLDS.adjustP95Ms,
      },
    }
    window.__bench = report
    return report
  } finally {
    setBusy(null)
  }
}
