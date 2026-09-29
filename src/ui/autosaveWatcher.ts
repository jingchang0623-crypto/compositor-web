// Keeps each tab's unsaved work in the browser: three seconds after the last change, one project at a time. Saved or
// untouched projects keep nothing; closing a project with unsaved work keeps it for recovery.

import { autosave, discardAutosave } from '../io/autosave'
import { flatten } from '../io/save'
import { engine } from './CanvasView'
import { getState, onClose, subscribe, type Tab } from './store'

const DELAY = 3000
const seen = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let running: Promise<void> = Promise.resolve()

async function thumbnail(tab: Tab): Promise<Blob | undefined> {
  const c = engine.compositor
  if (!c) return undefined
  const k = Math.min(1, 240 / Math.max(tab.doc.width, tab.doc.height))
  try {
    return await flatten(c, tab.doc, tab.store, Math.max(1, Math.round(tab.doc.width * k)), Math.max(1, Math.round(tab.doc.height * k)), true, 'image/jpeg', 0.8)
  } catch {
    return undefined
  }
}

function schedule(tab: Tab) {
  clearTimeout(timers.get(tab.id))
  timers.set(tab.id, setTimeout(() => {
    timers.delete(tab.id)
    running = running.then(async () => {
      const now = getState().tabs.find((t) => t.id === tab.id)
      // Still open, still unsaved, and not mid-stroke (a stroke's pixels are on the GPU until it ends).
      if (!now || !now.history.isModified || [...now.assets.values()].some((s) => 'texture' in s)) return
      const state = now.history.current
      // Images unchanged since opening are written as they were read, not encoded again.
      await autosave(now.autosaveKey, now.name, {
        doc: state.doc, assets: state.assets, activeLayerID: now.activeLayerID,
        original: { files: now.project.files, assets: now.project.assets },
      }, await thumbnail(now))
    }).catch((e) => console.warn('Autosave failed:', e))
  }, DELAY))
}

export function watchAutosave() {
  subscribe(() => {
    for (const tab of getState().tabs) {
      if (seen.get(tab.id) === tab.revision) continue
      seen.set(tab.id, tab.revision)
      if (tab.history.isModified) schedule(tab)
      else void discardAutosave(tab.autosaveKey) // Saved (or undone back to the file): nothing to keep.
    }
  })
  onClose((tab) => {
    clearTimeout(timers.get(tab.id))
    seen.delete(tab.id)
    // Unsaved work stays recoverable; anything else goes.
    if (!tab.history.isModified) void discardAutosave(tab.autosaveKey)
  })
  // Leaving the page with unsaved work asks first (the work is also kept for recovery).
  window.addEventListener('beforeunload', (e) => {
    if (getState().tabs.some((t) => t.history.isModified)) e.preventDefault()
  })
}
