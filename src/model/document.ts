// Structural edits to a document's layers, as pure functions: each returns a new layer array and leaves the old one
// as it was, for undo. Layers are kept in pre-order — a folder's record, then its contents — with siblings bottom to
// top, which renders the same as any other order the format allows.

import { CURRENT_VERSION, FORMAT, fullCanvasTransform, newID, type Adjustment, type AdjustmentKind, type LayerRecord, type LayerTransform, type Manifest } from './manifest'

type Children = Map<string | undefined, LayerRecord[]>

function children(layers: readonly LayerRecord[]): Children {
  const map: Children = new Map()
  for (const layer of layers) {
    const list = map.get(layer.parentID) ?? []
    list.push(layer)
    map.set(layer.parentID, list)
  }
  return map
}

function flatten(map: Children): LayerRecord[] {
  const out: LayerRecord[] = []
  const walk = (parent: string | undefined) => {
    for (const layer of map.get(parent) ?? []) {
      out.push(layer)
      if (layer.isGroup) walk(layer.id)
    }
  }
  walk(undefined)
  return out
}

export function descendants(layers: readonly LayerRecord[], id: string): LayerRecord[] {
  const map = children(layers)
  const out: LayerRecord[] = []
  const walk = (parent: string) => {
    for (const child of map.get(parent) ?? []) {
      out.push(child)
      if (child.isGroup) walk(child.id)
    }
  }
  walk(id)
  return out
}

export function depthOf(layers: readonly LayerRecord[], layer: LayerRecord): number {
  const byID = new Map(layers.map((l) => [l.id, l]))
  let depth = 0
  for (let p = layer.parentID; p; p = byID.get(p)?.parentID) depth++
  return depth
}

/** Adds `records` (a layer, or a folder followed by its contents) as siblings just above `anchorID`, or on top. */
export function insertAbove(layers: readonly LayerRecord[], anchorID: string | undefined, records: LayerRecord[]): LayerRecord[] {
  const anchor = layers.find((l) => l.id === anchorID)
  return insertInto(layers, anchor?.parentID, anchor?.id, records)
}

/** Adds `records` among `parentID`'s children: just above `anchorID`, or on top of them. */
export function insertInto(layers: readonly LayerRecord[], parentID: string | undefined, anchorID: string | undefined, records: LayerRecord[]): LayerRecord[] {
  const [head, ...rest] = records
  const placed = { ...head, parentID }
  const map = children(layers)
  const siblings = [...(map.get(parentID) ?? [])]
  const anchor = siblings.findIndex((l) => l.id === anchorID)
  siblings.splice(anchor >= 0 ? anchor + 1 : siblings.length, 0, placed)
  map.set(parentID, siblings)
  for (const r of rest) map.set(r.parentID, [...(map.get(r.parentID) ?? []), r])
  return flatten(map)
}

/**
 * Where a new layer goes, as in the desktop app: just above the active layer, among its siblings — or, when the active
 * layer is a folder, on top of that folder's contents.
 */
export function insertionPoint(layers: readonly LayerRecord[], activeID: string | undefined): { parentID?: string; anchorID?: string } {
  const active = layers.find((l) => l.id === activeID)
  if (!active) return {}
  if (active.isGroup) return { parentID: active.id }
  return { parentID: active.parentID, anchorID: active.id }
}

/** Removes layers and everything inside the folders among them. */
export function removeLayers(layers: readonly LayerRecord[], ids: Iterable<string>): LayerRecord[] {
  const gone = new Set<string>()
  for (const id of ids) {
    gone.add(id)
    for (const d of descendants(layers, id)) gone.add(d.id)
  }
  // Clipping links to removed layers are released rather than left dangling.
  return layers.filter((l) => !gone.has(l.id)).map((l) => (l.maskSourceID && gone.has(l.maskSourceID) ? { ...l, maskSourceID: undefined } : l))
}

/**
 * Moves a layer (with its contents) to sit among `parentID`'s children at `index`, counted bottom to top in the list
 * without the moved layer. A folder can't move into itself.
 */
export function moveLayer(layers: readonly LayerRecord[], id: string, parentID: string | undefined, index: number): LayerRecord[] {
  const layer = layers.find((l) => l.id === id)
  if (!layer) return [...layers]
  if (parentID === id || (parentID && descendants(layers, id).some((d) => d.id === parentID))) return [...layers]
  const map = children(layers)
  map.set(layer.parentID, (map.get(layer.parentID) ?? []).filter((l) => l !== layer))
  const moved = { ...layer, parentID }
  const siblings = [...(map.get(parentID) ?? [])]
  siblings.splice(Math.max(0, Math.min(siblings.length, index)), 0, moved)
  map.set(parentID, siblings)
  // Children refer to the folder by id; the moved record keeps its id, so they follow.
  return flatten(map)
}

/** Siblings of `layer`, bottom to top. */
export function siblingsOf(layers: readonly LayerRecord[], parentID: string | undefined): LayerRecord[] {
  return children(layers).get(parentID) ?? []
}

/** Wraps a layer in a new folder that takes its place. Returns the layers and the folder's id. */
export function groupLayer(layers: readonly LayerRecord[], id: string, folder: LayerRecord): LayerRecord[] {
  const layer = layers.find((l) => l.id === id)
  if (!layer) return [...layers]
  const map = children(layers)
  const siblings = [...(map.get(layer.parentID) ?? [])]
  siblings[siblings.indexOf(layer)] = { ...folder, parentID: layer.parentID }
  map.set(layer.parentID, siblings)
  map.set(folder.id, [{ ...layer, parentID: folder.id }])
  return flatten(map)
}

/** Replaces a folder with its contents, in place. */
export function ungroup(layers: readonly LayerRecord[], folderID: string): LayerRecord[] {
  const folder = layers.find((l) => l.id === folderID)
  if (!folder?.isGroup) return [...layers]
  const map = children(layers)
  const contents = (map.get(folderID) ?? []).map((c) => ({ ...c, parentID: folder.parentID }))
  const siblings = [...(map.get(folder.parentID) ?? [])]
  siblings.splice(siblings.indexOf(folder), 1, ...contents)
  map.set(folder.parentID, siblings)
  map.delete(folderID)
  return flatten(map)
}

/**
 * A copy of a layer (and a folder's contents) with new ids and image file names. `rename` maps each old file name to
 * its new one, so the caller can point the new names at the same (immutable) pixels.
 */
export function duplicate(layers: readonly LayerRecord[], id: string, name: (old: string) => string): { records: LayerRecord[]; rename: Map<string, string> } {
  const layer = layers.find((l) => l.id === id)
  if (!layer) return { records: [], rename: new Map() }
  const subtree = [layer, ...descendants(layers, id)]
  const ids = new Map(subtree.map((l) => [l.id, newID()]))
  const rename = new Map<string, string>()
  const records = subtree.map((l, i) => {
    const nid = ids.get(l.id)!
    const copy: LayerRecord = { ...l, id: nid, name: i === 0 ? name(l.name) : l.name }
    if (i > 0) copy.parentID = ids.get(l.parentID!) ?? l.parentID
    if (l.imageFile) { copy.imageFile = `${nid}.png`; rename.set(l.imageFile, copy.imageFile) }
    if (l.maskFile) { copy.maskFile = `${nid}.mask.png`; rename.set(l.maskFile, copy.maskFile) }
    if (l.maskSourceID && ids.has(l.maskSourceID)) copy.maskSourceID = ids.get(l.maskSourceID)
    return copy
  })
  return { records, rename }
}

// MARK: New records

export function pixelLayer(name: string, transform: LayerTransform, id = newID()): LayerRecord {
  return { id, name, isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal', transform }
}

export function folderLayer(name: string, width: number, height: number): LayerRecord {
  return { id: newID(), name, isVisible: true, isGroup: true, opacity: 1, blendMode: 'Normal', transform: fullCanvasTransform(width, height) }
}

const IDENTITY_RANGE = { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 }
const IDENTITY_CURVE = [{ x: 0, y: 0 }, { x: 255, y: 255 }]

/**
 * A new adjustment with identity settings, exactly as the desktop app encodes one: every kind carries the
 * Hue/Saturation fields and identity Levels and Curves blocks (its decoder requires them); kind-specific settings are
 * left out until changed, and read as their defaults.
 */
export function identityAdjustment(kind: AdjustmentKind): Adjustment {
  const adjustment: Adjustment = {
    kind, hue: 0, saturation: 0, lightness: 0, colorize: false,
    levels: { channel: 'RGB', ranges: [0, 1, 2, 3].map(() => ({ ...IDENTITY_RANGE })) },
    curves: { channel: 'RGB', channels: [0, 1, 2, 3].map(() => IDENTITY_CURVE.map((p) => ({ ...p }))) },
  }
  return adjustment
}

export function adjustmentLayer(kind: AdjustmentKind, width: number, height: number): LayerRecord {
  return { ...pixelLayer(kind, fullCanvasTransform(width, height)), adjustment: identityAdjustment(kind) }
}

export function blankManifest(width: number, height: number): Manifest {
  return { format: FORMAT, version: CURRENT_VERSION, colorSpace: 'sRGB', documentID: newID(), width, height, resolution: 72, layers: [] }
}

/** "Layer 3" after "Layer 1" and "Layer 2": the next free number for `base`. */
export function nextName(layers: readonly LayerRecord[], base: string): string {
  let n = 1
  const names = new Set(layers.map((l) => l.name))
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}
