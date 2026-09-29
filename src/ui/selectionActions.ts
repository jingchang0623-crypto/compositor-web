// Select menu commands. Selections are part of the tab, not of undo history (as the desktop app keeps them out of
// the file); ⌘D and friends act at once.

import { invert, selectAll } from '../model/selection'
import { commitStroke, paintEngine, paintOptions, resolveTarget } from './paintTarget'
import { activeTab, getState, notify, setSelection } from './store'

export function selectAllCanvas() {
  const tab = activeTab()
  if (tab) setSelection(selectAll(tab.doc.width, tab.doc.height))
}

export const deselect = () => setSelection(null)

export function inverseSelection() {
  const sel = activeTab()?.selection
  if (sel) setSelection(invert(sel))
}

// MARK: Through the selection

/**
 * Changes the active layer's pixels (or mask) inside the selection at once: Delete clears (on a mask, hides), ⌥⌫
 * fills with the foreground color, ⌘⌫ with the background.
 */
export function throughSelection(kind: 'clear' | 'foreground' | 'background') {
  const tab = activeTab()
  if (!tab?.selection) return notify('先用选框工具建立选区')
  const r = resolveTarget()
  const engine = paintEngine()
  if (!r || !engine) return
  const { colors } = getState()
  const color = kind === 'background' ? colors.bg : kind === 'foreground' ? colors.fg : r.mask ? [0, 0, 0] as [number, number, number] : undefined
  const stroke = engine.begin(r.target, paintOptions(r, kind === 'clear' && !r.mask, 1, color))
  stroke.fillAll()
  commitStroke(kind === 'clear' ? '清除' : '填充', r, stroke)
}
