// Zooming and fitting, as upstream Rendering/CanvasViewport.swift does it. Zoom is device pixels per document pixel,
// so 100% shows every image pixel on one screen pixel, on a Retina display too.

import type { View } from '../engine/compositor'

export const ZOOM_MIN = 0.001
export const ZOOM_MAX = 32
/** Where ⌘+ and ⌘− stop. */
export const KEYBOARD_ZOOM_LEVELS = [0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 12, 16]
/** Room left around a fitted canvas, in CSS pixels. */
const FIT_INSET = 96

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/** The whole document centered in a `width`×`height` device-pixel view. */
export function fitView(width: number, height: number, dpr: number, doc: { width: number; height: number }): View {
  const scale = clampZoom(Math.min(
    Math.max(1, width / dpr - FIT_INSET) / doc.width,
    Math.max(1, height / dpr - FIT_INSET) / doc.height,
  ) * dpr)
  return { scale, x: (width - doc.width * scale) / 2, y: (height - doc.height * scale) / 2 }
}

/** `view` at a new zoom, keeping the document point under (`ax`, `ay`) where it is. */
export function zoomTo(view: View, zoom: number, ax: number, ay: number): View {
  const scale = clampZoom(zoom)
  const k = scale / view.scale
  return { scale, x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k }
}

export function keyboardZoomTarget(zoom: number, step: 1 | -1): number {
  const tolerance = Math.max(1e-9, Math.abs(zoom) * 1e-9)
  if (step > 0) return KEYBOARD_ZOOM_LEVELS.find((z) => z > zoom + tolerance) ?? zoom
  return [...KEYBOARD_ZOOM_LEVELS].reverse().find((z) => z < zoom - tolerance) ?? zoom
}

export function formatZoom(zoom: number): string {
  const percent = zoom * 100
  return `${percent >= 10 ? Math.round(percent * 10) / 10 : Math.round(percent * 100) / 100}%`
}
