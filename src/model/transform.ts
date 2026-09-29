// Moving, scaling and rotating a layer's box, as upstream Document/LayerTransform.swift does: the box turns about its
// center (clockwise, y down), handles resize it against the opposite side, and dragging leaves whole pixels and degrees.

import type { LayerTransform } from './manifest'

export type Point = { x: number; y: number }
export type Box = { x0: number; y0: number; x1: number; y1: number }

const rad = (deg: number) => ((deg % 360) * Math.PI) / 180

export function center(t: LayerTransform): Point {
  return { x: t.origin[0] + t.size[0] / 2, y: t.origin[1] + t.size[1] / 2 }
}

/** A point in the box's own frame (from its center, unrotated) → document. */
export function toDocument(t: LayerTransform, local: Point): Point {
  const c = center(t), r = rad(t.rotation)
  return { x: c.x + local.x * Math.cos(r) - local.y * Math.sin(r), y: c.y + local.x * Math.sin(r) + local.y * Math.cos(r) }
}

export function toLocal(t: LayerTransform, p: Point): Point {
  const c = center(t), r = rad(t.rotation)
  const dx = p.x - c.x, dy = p.y - c.y
  return { x: dx * Math.cos(r) + dy * Math.sin(r), y: -dx * Math.sin(r) + dy * Math.cos(r) }
}

/** Top-left, top-right, bottom-right, bottom-left, as the box sits on the canvas. */
export function corners(t: LayerTransform): Point[] {
  const hw = t.size[0] / 2, hh = t.size[1] / 2
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => toDocument(t, { x, y }))
}

export function bounds(t: LayerTransform): Box {
  const cs = corners(t)
  return {
    x0: Math.min(...cs.map((c) => c.x)), y0: Math.min(...cs.map((c) => c.y)),
    x1: Math.max(...cs.map((c) => c.x)), y1: Math.max(...cs.map((c) => c.y)),
  }
}

export function translated(t: LayerTransform, dx: number, dy: number): LayerTransform {
  return { ...t, origin: [t.origin[0] + dx, t.origin[1] + dy] }
}

/** The same box turned to `degrees`, about its center. */
export function rotated(t: LayerTransform, degrees: number): LayerTransform {
  let d = degrees % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return { ...t, rotation: d }
}

/**
 * The box resized by dragging the handle at (`hx`, `hy`) — each −1, 0 or 1, the side it sits on — to `p`. The opposite
 * side stays put, or the center with `fromCenter`. Corner handles keep the proportions when `lockAspect`.
 */
export function resized(t: LayerTransform, hx: number, hy: number, p: Point, lockAspect: boolean, fromCenter: boolean): LayerTransform {
  const [w, h] = t.size
  const local = toLocal(t, p)
  // Where the fixed side (or the center) is, in the box's frame.
  const ax = fromCenter ? 0 : (-hx * w) / 2, ay = fromCenter ? 0 : (-hy * h) / 2
  let nw = hx ? Math.abs(local.x - ax) * (fromCenter ? 2 : 1) : w
  let nh = hy ? Math.abs(local.y - ay) * (fromCenter ? 2 : 1) : h
  if (lockAspect && hx && hy) {
    const k = Math.max(nw / w, nh / h)
    nw = w * k
    nh = h * k
  }
  nw = Math.max(1, nw)
  nh = Math.max(1, nh)
  // The new center, in the old box's frame: halfway from the fixed side, toward the dragged handle.
  const cx = fromCenter || !hx ? 0 : ax + (hx * nw) / 2
  const cy = fromCenter || !hy ? 0 : ay + (hy * nh) / 2
  const c = toDocument(t, { x: cx, y: cy })
  return { ...t, origin: [c.x - nw / 2, c.y - nh / 2], size: [nw, nh] }
}

/** Whole pixels and whole degrees, as dragging leaves them (upstream LayerTransform.rounded). */
export function rounded(t: LayerTransform): LayerTransform {
  return {
    ...t,
    origin: [Math.round(t.origin[0]), Math.round(t.origin[1])],
    size: [Math.max(1, Math.round(t.size[0])), Math.max(1, Math.round(t.size[1]))],
    rotation: Math.round(t.rotation),
  }
}

export interface SnapResult {
  dx: number
  dy: number
  guides: { axis: 'x' | 'y'; at: number }[]
}

/**
 * How far to nudge a moving box so its left, center or right (and top, middle or bottom) lands on the nearest target
 * within `threshold` document pixels — canvas edges and center, other layers' edges and centers.
 */
export function snap(box: Box, xs: number[], ys: number[], threshold: number): SnapResult {
  const pick = (edges: number[], targets: number[]) => {
    let best: { d: number; at: number } | null = null
    for (const e of edges) for (const t of targets) {
      const d = t - e
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }
    }
    return best
  }
  const bx = pick([box.x0, (box.x0 + box.x1) / 2, box.x1], xs)
  const by = pick([box.y0, (box.y0 + box.y1) / 2, box.y1], ys)
  const guides: SnapResult['guides'] = []
  if (bx) guides.push({ axis: 'x', at: bx.at })
  if (by) guides.push({ axis: 'y', at: by.at })
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides }
}

/** Snap targets: the canvas's edges and center, and each given box's edges and center. */
export function snapTargets(width: number, height: number, boxes: Box[]): { xs: number[]; ys: number[] } {
  const xs = [0, width / 2, width], ys = [0, height / 2, height]
  for (const b of boxes) {
    xs.push(b.x0, (b.x0 + b.x1) / 2, b.x1)
    ys.push(b.y0, (b.y0 + b.y1) / 2, b.y1)
  }
  return { xs, ys }
}
