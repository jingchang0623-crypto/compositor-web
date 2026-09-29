import type { BlendMode, LayerRecord, LayerTransform, Manifest } from './manifest'

/**
 * One drawing step. Folders are pass-through (their blend mode is always Normal), so they never need a surface of
 * their own: a folder's visibility, opacity and mask fold into each layer inside it, and the whole document draws
 * as one flat, bottom-to-top list.
 */
export interface DrawStep {
  layer: LayerRecord
  /** The layer's opacity times every enclosing folder's. */
  opacity: number
  blendMode: BlendMode
  /** Enclosing folders whose masks also cover this layer, innermost first. */
  folderMasks: LayerRecord[]
}

export function renderList(doc: Manifest): DrawStep[] {
  // Array order is bottom-to-top among siblings; a folder draws its whole subtree where its own record sits.
  const children = new Map<string | undefined, LayerRecord[]>()
  for (const layer of doc.layers) {
    const siblings = children.get(layer.parentID) ?? []
    siblings.push(layer)
    children.set(layer.parentID, siblings)
  }
  const steps: DrawStep[] = []
  const walk = (parent: string | undefined, opacity: number, folderMasks: LayerRecord[]) => {
    for (const layer of children.get(parent) ?? []) {
      if (!layer.isVisible) continue // A hidden folder hides everything inside it.
      const layerOpacity = opacity * (layer.opacity ?? 1)
      if (layer.isGroup) {
        const masked = layer.maskFile && layer.maskEnabled !== false
        walk(layer.id, layerOpacity, masked ? [layer, ...folderMasks] : folderMasks)
        continue
      }
      if (!layer.imageFile && !layer.adjustment) continue // A blank layer draws nothing.
      if (layerOpacity <= 0) continue
      steps.push({ layer, opacity: layerOpacity, blendMode: layer.blendMode ?? 'Normal', folderMasks })
    }
  }
  walk(undefined, 1, [])
  return steps
}

/**
 * The affine map from a layer's unit square (0…1, y down) to document pixels: scale to size, flip, rotate about the
 * center, as upstream `LayerTransform.point` does. Column-major 3×3.
 */
export function unitToDocument(t: LayerTransform): Float32Array {
  const [x, y] = t.origin, [w, h] = t.size
  const r = ((t.rotation % 360) * Math.PI) / 180
  const cos = Math.cos(r), sin = Math.sin(r)
  const sx = t.flipX ? -w : w, sy = t.flipY ? -h : h
  const cx = x + w / 2, cy = y + h / 2
  // p = center + R · (S · (u − 0.5))
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy
  const e = cx - 0.5 * (a + c), f = cy - 0.5 * (b + d)
  return new Float32Array([a, b, 0, c, d, 0, e, f, 1])
}

export function invert3(m: Float32Array): Float32Array {
  const [a, b, , c, d, , e, f] = m
  const det = a * d - b * c
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det
  return new Float32Array([ia, ib, 0, ic, id, 0, -(ia * e + ic * f), -(ib * e + id * f), 1])
}
