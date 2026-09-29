import { useEffect, useRef, useState } from 'react'
import { CanvasRenderer } from '../engine/canvasRenderer'
import { Compositor, type View } from '../engine/compositor'
import { compareWithPreview } from '../io/compare'
import { activeTab, activeView, onRelease, setComparison, setError, setView, subscribe, useEditor, type Tab } from './store'
import { fitView, keyboardZoomTarget, zoomTo } from './viewport'

/** The one GPU context, shared by the canvas, the benchmark and preview comparisons. */
export const engine: {
  compositor?: Compositor
  renderer?: CanvasRenderer
  canvas?: HTMLCanvasElement
  /** Draws the active tab now, rather than at the next display frame. */
  drawNow: () => void
} = { drawNow: () => {} }

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tool = useEditor((s) => s.tool)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [optionHeld, setOptionHeld] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current!
    try {
      engine.compositor ??= new Compositor(canvas)
      engine.renderer ??= new CanvasRenderer(engine.compositor)
      engine.canvas = canvas
      // Textures for pixels no tab or undo step can show again are let go.
      onRelease((keep) => engine.compositor?.retainOnly(keep))
    } catch (e) {
      setError(String(e))
      return
    }
    const renderer = engine.renderer
    let pending = false
    let drawn: { doc: unknown; store: unknown; view: View } | null = null

    const draw = () => {
      const tab = activeTab(), view = activeView()?.view
      if (!tab) {
        const gl = engine.compositor!.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.clearColor(0.141, 0.141, 0.141, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        drawn = null
        return
      }
      if (!view) return
      renderer.frame(tab.doc, tab.store, canvas.width, canvas.height, view)
      drawn = { doc: tab.doc, store: tab.store, view }
    }
    engine.drawNow = draw
    const requestDraw = () => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        draw()
      })
    }

    // A tab seen for the first time, or one that follows the window, is fitted to it.
    const layout = (tab: Tab | null) => {
      if (!tab || !canvas.width || !canvas.height) return
      const current = activeView()
      if (!current || current.followsFit) {
        const fit = fitView(canvas.width, canvas.height, devicePixelRatio, tab.doc)
        const v = current?.view
        if (!v || v.scale !== fit.scale || v.x !== fit.x || v.y !== fit.y) setView(fit, true)
      }
    }

    const onChange = () => {
      const tab = activeTab()
      layout(tab)
      const view = activeView()?.view
      if (!drawn !== !tab || (tab && (drawn?.doc !== tab.doc || drawn?.store !== tab.store || drawn?.view !== view)))
        requestDraw()
    }
    const unsubscribe = subscribe(onChange)

    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))
      layout(activeTab())
      draw() // At once: a resized canvas is blank until drawn.
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    // Scroll pans; a pinch (ctrl + wheel), or ⌘/⌥ with the wheel, zooms at the pointer.
    const onWheel = (e: WheelEvent) => {
      const v = activeView()?.view
      if (!v) return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const ax = (e.clientX - rect.left) * devicePixelRatio, ay = (e.clientY - rect.top) * devicePixelRatio
      const lines = e.deltaMode === 1 ? 16 : 1
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const factor = Math.exp(-e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.002))
        setView(zoomTo(v, v.scale * factor, ax, ay))
      } else {
        setView({ ...v, x: v.x - e.deltaX * lines * devicePixelRatio, y: v.y - e.deltaY * lines * devicePixelRatio })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    // Safari reports a trackpad pinch as gesture events rather than ctrl + wheel.
    let gestureStart: { scale: number; x: number; y: number } | null = null
    const onGestureStart = (e: Event) => {
      const v = activeView()?.view
      if (!v) return
      e.preventDefault()
      const g = e as unknown as { clientX: number; clientY: number }
      const rect = canvas.getBoundingClientRect()
      gestureStart = { scale: v.scale, x: (g.clientX - rect.left) * devicePixelRatio, y: (g.clientY - rect.top) * devicePixelRatio }
    }
    const onGestureChange = (e: Event) => {
      const v = activeView()?.view
      if (!v || !gestureStart) return
      e.preventDefault()
      setView(zoomTo(v, gestureStart.scale * (e as unknown as { scale: number }).scale, gestureStart.x, gestureStart.y))
    }
    canvas.addEventListener('gesturestart', onGestureStart)
    canvas.addEventListener('gesturechange', onGestureChange)

    return () => {
      unsubscribe()
      observer.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
    }
  }, [])

  // Compare with the desktop app's own preview once, when a project that has one opens.
  useEffect(() => subscribe(() => {
    const tab = activeTab()
    if (!tab?.project.preview || tab.comparison !== undefined || !engine.compositor) return
    setComparison(tab.id, null)
    void compareWithPreview(engine.compositor, tab.project).then((c) => setComparison(tab.id, c))
  }), [])

  // Space held: the hand, whatever the tool. Option: the zoom tool zooms out.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        e.preventDefault()
        setSpaceHeld(true)
      }
      if (e.key === 'Alt') setOptionHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
      if (e.key === 'Alt') setOptionHeld(false)
    }
    const blur = () => { setSpaceHeld(false); setOptionHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // MARK: Pointer

  const gesture = useRef<{ kind: 'pan' | 'zoom'; x: number; y: number; start: View; moved: boolean; alt: boolean } | null>(null)
  const panning = spaceHeld || tool === 'hand'
  const zooming = !spaceHeld && tool === 'zoom'
  const cursor = panning ? (dragging ? 'grabbing' : 'grab') : zooming ? (optionHeld ? 'zoom-out' : 'zoom-in') : 'default'

  const point = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * devicePixelRatio, y: (e.clientY - rect.top) * devicePixelRatio }
  }

  return (
    <canvas
      ref={canvasRef}
      className="canvas"
      style={{ cursor }}
      onPointerDown={(e) => {
        const v = activeView()?.view
        if (!v || e.button !== 0 || !(panning || zooming)) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = point(e)
        gesture.current = { kind: panning ? 'pan' : 'zoom', ...p, start: v, moved: false, alt: e.altKey }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const g = gesture.current
        if (!g) return
        const p = point(e)
        const dx = p.x - g.x, dy = p.y - g.y
        if (Math.hypot(dx, dy) > 3 * devicePixelRatio) g.moved = true
        if (g.kind === 'pan') setView({ ...g.start, x: g.start.x + dx, y: g.start.y + dy })
        // Dragging right zooms in and left zooms out, smoothly, about where the drag began.
        else if (g.moved) setView(zoomTo(g.start, g.start.scale * Math.exp(dx / (devicePixelRatio * 150)), g.x, g.y))
      }}
      onPointerUp={() => {
        const g = gesture.current
        gesture.current = null
        setDragging(false)
        const v = activeView()?.view
        if (g?.kind === 'zoom' && !g.moved && v) setView(zoomTo(v, keyboardZoomTarget(v.scale, g.alt ? -1 : 1), g.x, g.y))
      }}
    />
  )
}
