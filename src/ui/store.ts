// The editor's state: open projects as tabs, each with its own undo history, plus the chosen tool and its options.
// A small store rather than React state, so the canvas can redraw on every change without re-rendering the panels,
// and panels re-render only for their slice.

import { useSyncExternalStore } from 'react'
import type { AssetStore, PixelSource, View } from '../engine/compositor'
import { assetStore, type LoadedProject } from '../io/comp'
import type { PreviewComparison } from '../io/compare'
import { blankManifest } from '../model/document'
import { History, type DocState } from '../model/history'
import { newID, type LayerRecord, type Manifest } from '../model/manifest'
import type { Selection } from '../model/selection'
import type { ToolID } from './tools'

/** Which pixels of the active layer painting and filling change. Session-only, as in the desktop app. */
export type EditTarget = 'image' | 'mask'

export interface Tab {
  id: string
  name: string
  project: LoadedProject
  history: History
  /** The history's current state, spread out for the renderer and panels. */
  doc: Manifest
  assets: ReadonlyMap<string, PixelSource>
  /** Same identity while `assets` is unchanged, so the renderer can tell a pan from an edit. */
  store: AssetStore
  activeLayerID?: string
  target: EditTarget
  collapsed: ReadonlySet<string>
  selection: Selection | null
  comparison?: PreviewComparison | null
  /** Where ⌘S writes: back into the folder it came from, when the browser allows it. */
  folder?: FileSystemDirectoryHandle
  /** Bumped by every change to the document, for autosave and the title's edited dot. */
  revision: number
}

/** Kept apart from the tab, so panning re-renders only what shows the zoom, not the layer list. */
export interface ViewState {
  view: View
  /** Refits when the window resizes, until the person pans or zooms. */
  followsFit: boolean
}

export interface BrushOptions {
  size: number
  hardness: number
  opacity: number
  erase: boolean
}

export interface EditorState {
  tabs: Tab[]
  /** By tab; missing until the canvas first lays the document out. */
  views: Record<string, ViewState>
  activeTabID: string | null
  tool: ToolID
  brush: BrushOptions
  /** Foreground and background, sRGB 0–1. */
  colors: { fg: [number, number, number]; bg: [number, number, number] }
  marquee: 'rectangle' | 'ellipse'
  autoSelect: boolean
  showTransform: boolean
  busy: string | null
  error: string | null
  notice: string | null
  layersWidth: number
}

let state: EditorState = {
  tabs: [],
  views: {},
  activeTabID: null,
  tool: 'move',
  brush: { size: 60, hardness: 0.8, opacity: 1, erase: false },
  colors: { fg: [0, 0, 0], bg: [1, 1, 1] },
  marquee: 'rectangle',
  autoSelect: false,
  showTransform: true,
  busy: null,
  error: null,
  notice: null,
  layersWidth: 252,
}
const listeners = new Set<() => void>()

export const getState = () => state
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function set(patch: Partial<EditorState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
/** A slice of the state; re-renders only when that slice changes (by identity). */
export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

export const activeTab = (s: EditorState = state) => s.tabs.find((t) => t.id === s.activeTabID) ?? null
export const activeView = (s: EditorState = state): ViewState | null => (s.activeTabID ? s.views[s.activeTabID] ?? null : null)
export function activeLayer(s: EditorState = state): LayerRecord | null {
  const tab = activeTab(s)
  return tab?.doc.layers.find((l) => l.id === tab.activeLayerID) ?? null
}

function updateTab(id: string, update: (tab: Tab) => Tab) {
  set({ tabs: state.tabs.map((t) => (t.id === id ? update(t) : t)) })
}
function updateActive(update: (tab: Tab) => Tab) {
  if (state.activeTabID) updateTab(state.activeTabID, update)
}

/** The tab showing `history`'s current state. */
function fromHistory(tab: Tab): Tab {
  const { doc, assets } = tab.history.current
  const activeLayerID = doc.layers.some((l) => l.id === tab.activeLayerID) ? tab.activeLayerID : doc.layers.at(-1)?.id
  return {
    ...tab, doc, assets, activeLayerID,
    store: assets === tab.assets ? tab.store : assetStore(assets),
    revision: tab.revision + 1,
  }
}

// MARK: Editing

/**
 * Changes the active document as one undo step (or folds into the open step with the same `key`, for gestures).
 * `change` gets the current state and returns the next, or null to change nothing.
 */
export function edit(name: string, change: (s: DocState, tab: Tab) => DocState | null, key?: string, select?: string) {
  const tab = activeTab()
  if (!tab) return
  const next = change(tab.history.current, tab)
  if (!next || next === tab.history.current) return
  tab.history.commit(name, next, key)
  updateTab(tab.id, (t) => {
    const next = fromHistory(t)
    return select ? { ...next, activeLayerID: select, target: 'image' } : next
  })
  scheduleRelease()
}

/** Changes layer records by id, as one step. */
export function editLayers(name: string, patch: (layer: LayerRecord) => LayerRecord | null, key?: string) {
  edit(name, (s) => {
    let changed = false
    const layers = s.doc.layers.map((l) => {
      const next = patch(l)
      if (!next || next === l) return l
      changed = true
      return next
    })
    return changed ? { ...s, doc: { ...s.doc, layers } } : null
  }, key)
}

export function updateLayer(id: string, patch: Partial<LayerRecord>, name = '更改图层', key?: string) {
  editLayers(name, (l) => (l.id === id ? { ...l, ...patch } : null), key)
}

/** Ends a gesture: the next change of the same kind is its own undo step. */
export function seal() {
  activeTab()?.history.seal()
}

export function undo() {
  const tab = activeTab()
  if (!tab?.history.undo()) return
  updateTab(tab.id, fromHistory)
  notify(`已撤销`)
}

export function redo() {
  const tab = activeTab()
  if (!tab?.history.redo()) return
  updateTab(tab.id, fromHistory)
  notify(`已重做`)
}

// GPU textures for pixels nothing can show any more — not the current state, not any undo step — are let go.
let releaseTimer: ReturnType<typeof setTimeout> | undefined
const releaseHooks = new Set<(keep: Set<PixelSource>) => void>()
export function onRelease(hook: (keep: Set<PixelSource>) => void) {
  releaseHooks.add(hook)
}
function scheduleRelease() {
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    const keep = new Set<PixelSource>()
    for (const tab of state.tabs) for (const s of tab.history.sources()) keep.add(s)
    for (const hook of releaseHooks) hook(keep)
  }, 500)
}

// MARK: Tabs

export function openProject(project: LoadedProject) {
  const initial: DocState = { doc: project.manifest, assets: project.assets }
  const tab: Tab = {
    id: newID(),
    name: project.name.replace(/\.zip$/i, '').replace(/\.comp$/i, ''),
    project,
    history: new History(initial),
    doc: project.manifest,
    assets: project.assets,
    store: assetStore(project.assets),
    activeLayerID: project.manifest.activeLayerID ?? project.manifest.layers.at(-1)?.id,
    target: 'image',
    collapsed: new Set(),
    selection: null,
    folder: project.folder,
    revision: 0,
  }
  set({ tabs: [...state.tabs, tab], activeTabID: tab.id, error: null })
  return tab
}

export function newCanvas(width: number, height: number, name?: string) {
  const untitled = state.tabs.filter((t) => t.name.startsWith('未命名')).length
  return openProject({
    name: name ?? (untitled ? `未命名 ${untitled + 1}` : '未命名'),
    manifest: blankManifest(width, height), assets: new Map(), warnings: [],
  })
}

export function closeTab(id: string) {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index < 0) return
  const closing = state.tabs[index]
  const tabs = state.tabs.filter((t) => t.id !== id)
  const next = state.activeTabID === id ? (tabs[index] ?? tabs[index - 1] ?? null)?.id ?? null : state.activeTabID
  const views = { ...state.views }
  delete views[id]
  set({ tabs, views, activeTabID: next })
  // Let the pixels go once nothing shows them.
  const stillShown = new Set<PixelSource>()
  for (const tab of tabs) for (const s of tab.history.sources()) stillShown.add(s)
  for (const source of closing.history.sources()) if (!stillShown.has(source) && source instanceof ImageBitmap) source.close()
  closing.project.preview?.close()
  scheduleRelease()
}

export const activateTab = (id: string) => set({ activeTabID: id })

export function renameTab(id: string, name: string) {
  updateTab(id, (t) => ({ ...t, name }))
}

export function markSaved(tabID: string, folder?: FileSystemDirectoryHandle, name?: string) {
  // The history was marked with the state that was written; edits made while writing stay unsaved.
  updateTab(tabID, (t) => ({ ...t, folder: folder ?? t.folder, name: name ?? t.name, revision: t.revision + 1 }))
}

// MARK: View

export function setView(view: View, followsFit = false) {
  if (state.activeTabID) set({ views: { ...state.views, [state.activeTabID]: { view, followsFit } } })
}

// MARK: Layers

export function selectLayer(id: string, target: EditTarget = 'image') {
  updateActive((t) => ({ ...t, activeLayerID: id, target }))
}

export function setTarget(target: EditTarget) {
  updateActive((t) => ({ ...t, target }))
}

export function toggleCollapsed(id: string) {
  updateActive((t) => {
    const collapsed = new Set(t.collapsed)
    if (!collapsed.delete(id)) collapsed.add(id)
    return { ...t, collapsed }
  })
}

/** Swaps the whole document of the active tab without a history step (the benchmark drives edits this way). */
export function replaceDoc(doc: Manifest) {
  updateActive((t) => ({ ...t, doc }))
}

/** Shows pixels still being painted, without a history step: the stroke commits once it ends. */
export function previewAssets(assets: ReadonlyMap<string, PixelSource>) {
  updateActive((t) => ({ ...t, assets, store: assetStore(assets) }))
}

export function setComparison(tabID: string, comparison: PreviewComparison | null) {
  updateTab(tabID, (t) => ({ ...t, comparison }))
}

export function setSelection(selection: Selection | null) {
  updateActive((t) => ({ ...t, selection }))
}

// MARK: Tools and chrome

export const setTool = (tool: ToolID) => set({ tool })
export const setBrush = (patch: Partial<BrushOptions>) => set({ brush: { ...state.brush, ...patch } })
export const setColors = (colors: EditorState['colors']) => set({ colors })
export const setMarquee = (marquee: EditorState['marquee']) => set({ marquee })
export const setAutoSelect = (autoSelect: boolean) => set({ autoSelect })
export const setShowTransform = (showTransform: boolean) => set({ showTransform })
export const setBusy = (busy: string | null) => set({ busy })
export const setError = (error: string | null) => set({ error })
export const setLayersWidth = (width: number) => set({ layersWidth: Math.min(352, Math.max(202, width)) })

let noticeTimer: ReturnType<typeof setTimeout> | undefined
/** A short message at the foot of the canvas, gone after a moment. */
export function notify(notice: string) {
  clearTimeout(noticeTimer)
  set({ notice })
  noticeTimer = setTimeout(() => set({ notice: null }), 1600)
}
