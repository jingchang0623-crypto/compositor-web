// G0.2 / G0.3: frame times while the view pans and zooms, and while an adjustment's settings change every frame.

export interface FrameStats {
  frames: number
  avgFps: number
  avgMs: number
  p95Ms: number
  maxMs: number
  /** CPU time spent building and submitting each frame, which excludes the GPU's own work. */
  avgSubmitMs: number
}

export function stats(deltas: number[], submits: number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b)
  const avg = deltas.reduce((s, d) => s + d, 0) / Math.max(1, deltas.length)
  return {
    frames: deltas.length,
    avgFps: 1000 / avg,
    avgMs: avg,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    avgSubmitMs: submits.reduce((s, d) => s + d, 0) / Math.max(1, submits.length),
  }
}

/**
 * Calls `frame` once per display frame for `durationMs`, with progress 0…1, and times each frame from one
 * animation callback to the next — what a person sees, GPU included, since the browser stops handing out frames
 * while the GPU is behind.
 */
export function animate(durationMs: number, frame: (progress: number) => void): Promise<FrameStats> {
  return new Promise((resolve) => {
    const deltas: number[] = [], submits: number[] = []
    let start = 0, last = 0
    const tick = (now: number) => {
      if (!start) start = last = now
      else deltas.push(now - last)
      last = now
      const progress = Math.min(1, (now - start) / durationMs)
      const t0 = performance.now()
      frame(progress)
      submits.push(performance.now() - t0)
      if (progress < 1) requestAnimationFrame(tick)
      else resolve(stats(deltas.slice(2), submits.slice(2))) // The first frames include warm-up.
    }
    requestAnimationFrame(tick)
  })
}

export const THRESHOLDS = {
  navigateFps: 50,
  navigateP95Ms: 25,
  adjustP95Ms: 50,
}
