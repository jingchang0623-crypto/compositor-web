// The editor's state: open projects as tabs, the chosen tool, and what's busy. A small store rather than React state,
// so the canvas can redraw on every change without re-rendering the panels, and panels re-render only for their slice.

import { useSyncExternalStore } from 'react'
import type { AssetStore, PixelSource, View } from '../engine/compositor'
import { assetStore, type LoadedProject } from '../io/comp'
import type { PreviewComparison } from '../io/compare'
import { CURRENT_VERSION, FORMAT, newID, type LayerRecord, type Manifest } from '../model/manifest'
import type { ToolID } from './tools'

export interface Tab {
  id: string
  name: string
  project: LoadedProject
  doc: Manifest
  store: AssetStore
  activeLayerID?: string
  collapsed: ReadonlySet<string>
  comparison?: PreviewComparison | null
}

/** Kept apart from the tab, so panning re-renders only what shows the zoom, not the layer list. */
export interface ViewState {
  view: View
  /** Refits when the window resizes, until the person pans or zooms. */
  followsFit: boolean
}

export interface EditorState {
  tabs: Tab[]
  /** By tab; missing until the canvas first lays the document out. */
  views: Record<string, ViewState>
  activeTabID: string | null
  tool: ToolID
  busy: string | null
  error: string | null
  layersWidth: number
}

let state: EditorState = {
  tabs: [],
  views: {},
  activeTabID: null,
  tool: 'hand',
  busy: null,
  error: null,
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

function updateTab(id: string, update: (tab: Tab) => Tab) {
  set({ tabs: state.tabs.map((t) => (t.id === id ? update(t) : t)) })
}
function updateActive(update: (tab: Tab) => Tab) {
  if (state.activeTabID) updateTab(state.activeTabID, update)
}

// MARK: Tabs

export function openProject(project: LoadedProject) {
  const tab: Tab = {
    id: newID(),
    name: project.name.replace(/\.zip$/i, ''),
    project,
    doc: project.manifest,
    store: assetStore(project.assets),
    activeLayerID: project.manifest.activeLayerID ?? project.manifest.layers.at(-1)?.id,
    collapsed: new Set(),
  }
  set({ tabs: [...state.tabs, tab], activeTabID: tab.id, error: null })
  return tab
}

export function newCanvas(width: number, height: number) {
  const manifest: Manifest = {
    format: FORMAT, version: CURRENT_VERSION, colorSpace: 'sRGB', documentID: newID(), width, height, resolution: 72, layers: [],
  }
  const untitled = state.tabs.filter((t) => t.name.startsWith('未命名')).length
  return openProject({ name: untitled ? `未命名 ${untitled + 1}` : '未命名', manifest, assets: new Map(), warnings: [] })
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
  for (const source of closing.project.assets.values()) closeSource(source)
  closing.project.preview?.close()
}

function closeSource(source: PixelSource) {
  if ('close' in source) source.close()
}

export const activateTab = (id: string) => set({ activeTabID: id })

// MARK: View

export function setView(view: View, followsFit = false) {
  if (state.activeTabID) set({ views: { ...state.views, [state.activeTabID]: { view, followsFit } } })
}

// MARK: Layers

export function selectLayer(id: string) {
  updateActive((t) => ({ ...t, activeLayerID: id }))
}

export function updateLayer(id: string, patch: Partial<LayerRecord>) {
  updateActive((t) => ({ ...t, doc: { ...t.doc, layers: t.doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) } }))
}

export function toggleCollapsed(id: string) {
  updateActive((t) => {
    const collapsed = new Set(t.collapsed)
    if (!collapsed.delete(id)) collapsed.add(id)
    return { ...t, collapsed }
  })
}

/** Swaps the whole document of the active tab (the benchmark drives edits this way). */
export function replaceDoc(doc: Manifest) {
  updateActive((t) => ({ ...t, doc }))
}

export function setComparison(tabID: string, comparison: PreviewComparison | null) {
  updateTab(tabID, (t) => ({ ...t, comparison }))
}

// MARK: Tools and chrome

export const setTool = (tool: ToolID) => set({ tool })
export const setBusy = (busy: string | null) => set({ busy })
export const setError = (error: string | null) => set({ error })
export const setLayersWidth = (width: number) => set({ layersWidth: Math.min(352, Math.max(202, width)) })
