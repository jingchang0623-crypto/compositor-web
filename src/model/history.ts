// Undo as snapshots, like upstream Document/DocumentHistory.swift: each step keeps the whole document state, and
// states share every layer record and pixel source they didn't change, so a step costs only what it changed.

import type { PixelSource } from '../engine/compositor'
import { RasterSource } from '../engine/raster'
import type { Manifest } from './manifest'

/** A document and its pixels, by image file name. Never mutated: an edit makes a new one. */
export interface DocState {
  readonly doc: Manifest
  readonly assets: ReadonlyMap<string, PixelSource>
}

interface Entry {
  name: string
  before: DocState
  after: DocState
  /** Steps of one gesture (a slider drag, a nudge run) merge while their key matches and the entry is open. */
  key?: string
  open: boolean
}

export function sourceBytes(source: PixelSource): number {
  if (source instanceof RasterSource) return source.bytes
  if ('data' in source) return source.data.length
  if ('texture' in source) return 0
  return source.width * source.height * 4
}

export class History {
  private past: Entry[] = []
  private future: Entry[] = []
  private savedState: DocState
  current: DocState

  constructor(initial: DocState, readonly entryLimit = 100, readonly byteLimit = 256 * 1024 * 1024) {
    this.current = initial
    this.savedState = initial
  }

  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  get undoName() { return this.past.at(-1)?.name ?? '' }
  get redoName() { return this.future.at(-1)?.name ?? '' }
  get depth() { return this.past.length }
  get isModified() { return this.current !== this.savedState }
  markSaved(state = this.current) { this.savedState = state }
  /** Nothing on disk matches this document (work recovered from an autosave). */
  forgetSaved() { this.savedState = { doc: this.current.doc, assets: new Map() } }

  /** Records `next` as one step, or folds it into the open step with the same `key`. */
  commit(name: string, next: DocState, key?: string) {
    if (next === this.current) return
    const last = this.past.at(-1)
    if (key !== undefined && last?.open && last.key === key) {
      last.after = next
    } else {
      this.seal()
      this.past.push({ name, before: this.current, after: next, key, open: key !== undefined })
    }
    this.current = next
    this.future = []
    this.prune()
  }

  /** Ends the open gesture, so the next change is a step of its own. */
  seal() {
    const last = this.past.at(-1)
    if (last) last.open = false
  }

  undo(): DocState | null {
    const entry = this.past.pop()
    if (!entry) return null
    entry.open = false
    this.future.push(entry)
    this.current = entry.before
    return this.current
  }

  redo(): DocState | null {
    const entry = this.future.pop()
    if (!entry) return null
    this.past.push(entry)
    this.current = entry.after
    return this.current
  }

  /** Every pixel source any step can bring back. */
  sources(): Set<PixelSource> {
    const out = new Set<PixelSource>()
    const add = (s: DocState) => { for (const src of s.assets.values()) out.add(src) }
    add(this.current)
    for (const e of [...this.past, ...this.future]) { add(e.before); add(e.after) }
    return out
  }

  /** Bytes held only for history: pixels no longer in the current state. */
  retainedBytes(): number {
    const current = new Set(this.current.assets.values())
    // Tiles the current state shares with older ones cost nothing extra.
    const counted = new Set<Uint8Array>()
    for (const source of current) if (source instanceof RasterSource) for (const t of source.tiles) if (t) counted.add(t)
    let bytes = 0
    for (const source of this.sources()) {
      if (current.has(source)) continue
      if (source instanceof RasterSource) {
        for (const t of source.tiles) if (t && !counted.has(t)) { counted.add(t); bytes += t.length }
      } else bytes += sourceBytes(source)
    }
    return bytes
  }

  private prune() {
    while (this.past.length > this.entryLimit) this.past.shift()
    while (this.past.length > 1 && this.retainedBytes() > this.byteLimit) this.past.shift()
  }
}
