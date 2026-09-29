// What's drawn over the canvas while a tool works — snap lines, a marquee being dragged, the brush outline — kept out
// of the editor state, since it changes on every pointer move and nothing else needs it.

import { useSyncExternalStore } from 'react'
import type { SelectionShape } from '../model/selection'

export interface OverlayState {
  /** Snap lines, in document pixels. */
  guides: { axis: 'x' | 'y'; at: number }[]
  /** A marquee being dragged, in document pixels. */
  marquee: SelectionShape | null
  /** The brush outline: center in document pixels, radius in document pixels. */
  brush: { x: number; y: number; r: number } | null
}

let state: OverlayState = { guides: [], marquee: null, brush: null }
const listeners = new Set<() => void>()

export function setOverlay(patch: Partial<OverlayState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
export const getOverlay = () => state
export function useOverlay<T>(select: (s: OverlayState) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => select(state))
}
