// Select menu commands. Selections are part of the tab, not of undo history (as the desktop app keeps them out of
// the file); ⌘D and friends act at once.

import { invert, selectAll } from '../model/selection'
import { activeTab, setSelection } from './store'

export function selectAllCanvas() {
  const tab = activeTab()
  if (tab) setSelection(selectAll(tab.doc.width, tab.doc.height))
}

export const deselect = () => setSelection(null)

export function inverseSelection() {
  const sel = activeTab()?.selection
  if (sel) setSelection(invert(sel))
}
