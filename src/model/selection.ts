// A selection as shapes, like upstream's vector path (Document/Selection.swift): rectangles and ellipses added or
// subtracted in order, over the canvas or its inverse. Turned into pixels only when an edit needs them.

export interface SelectionShape {
  kind: 'rect' | 'ellipse'
  op: 'add' | 'subtract'
  x: number
  y: number
  w: number
  h: number
}

export interface Selection {
  shapes: readonly SelectionShape[]
  /** Everything on the canvas except the shapes. */
  inverted: boolean
}

export function selectAll(width: number, height: number): Selection {
  return { shapes: [{ kind: 'rect', op: 'add', x: 0, y: 0, w: width, h: height }], inverted: false }
}

function inside(s: SelectionShape, x: number, y: number) {
  if (s.kind === 'rect') return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h
  const rx = s.w / 2, ry = s.h / 2
  const dx = (x - s.x - rx) / rx, dy = (y - s.y - ry) / ry
  return dx * dx + dy * dy <= 1
}

export function contains(sel: Selection, x: number, y: number): boolean {
  let hit = false
  for (const s of sel.shapes) if (inside(s, x, y)) hit = s.op === 'add'
  return hit !== sel.inverted
}

/** The selected area's bounding box on the canvas, or null when nothing is. */
export function bounds(sel: Selection, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  if (sel.inverted) return { x: 0, y: 0, w: width, h: height }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of sel.shapes) {
    if (s.op !== 'add') continue
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h)
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0))
  x1 = Math.min(width, Math.ceil(x1)); y1 = Math.min(height, Math.ceil(y1))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

export function combine(sel: Selection | null, shape: SelectionShape): Selection {
  if (!sel || (shape.op === 'add' && !sel.shapes.length)) return { shapes: [shape], inverted: false }
  // Adding to an inverted selection subtracts from what it leaves out, and the other way round.
  const op = sel.inverted ? (shape.op === 'add' ? 'subtract' : 'add') : shape.op
  return { ...sel, shapes: [...sel.shapes, { ...shape, op }] }
}

export function translate(sel: Selection, dx: number, dy: number): Selection {
  return { ...sel, shapes: sel.shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) }
}

export function invert(sel: Selection): Selection {
  return { ...sel, inverted: !sel.inverted }
}

/** The one shape a selection is, when it's a single added rectangle or ellipse (drawn exactly rather than traced). */
export function single(sel: Selection): SelectionShape | null {
  return !sel.inverted && sel.shapes.length === 1 && sel.shapes[0].op === 'add' ? sel.shapes[0] : null
}

/**
 * Coverage (0–255) over the canvas at `scale`, antialiased like the desktop app's selections. Draws with a 2D canvas,
 * so it runs in the browser only.
 */
export function rasterize(sel: Selection, width: number, height: number, scale = 1): Uint8Array {
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.setTransform(scale, 0, 0, scale, 0, 0)
  for (const s of sel.shapes) {
    g.globalCompositeOperation = s.op === 'add' ? 'source-over' : 'destination-out'
    g.fillStyle = '#fff'
    g.beginPath()
    if (s.kind === 'rect') g.rect(s.x, s.y, s.w, s.h)
    else g.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2)
    g.fill()
  }
  if (sel.inverted) {
    g.globalCompositeOperation = 'xor'
    g.fillRect(0, 0, width, height)
  }
  const rgba = g.getImageData(0, 0, w, h).data
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3]
  return out
}

/**
 * Outlines of a coverage mask as closed polylines, in mask pixels: the edges between cells at least half covered
 * and those less, joined end to end. For drawing marching ants around selections that aren't one simple shape.
 */
export function trace(mask: Uint8Array, w: number, h: number): number[][] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128
  // Directed edges keep the selected side on the left; each start point maps to its edges.
  const edges = new Map<number, number[]>()
  const key = (x: number, y: number) => y * (w + 1) + x
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0)
    const list = edges.get(k) ?? []
    list.push(key(x1, y1))
    edges.set(k, list)
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      if (!on(x, y - 1)) add(x, y, x + 1, y)
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!on(x - 1, y)) add(x, y + 1, x, y)
    }
  const loops: number[][] = []
  for (const [start] of edges) {
    let at = start
    const pts: number[] = []
    while (edges.get(at)?.length) {
      const list = edges.get(at)!
      const next = list.pop()!
      if (!list.length) edges.delete(at)
      const x = at % (w + 1), y = Math.floor(at / (w + 1))
      // Keep corners only: a point where the direction turns.
      pts.push(x, y)
      at = next
    }
    if (pts.length >= 6) loops.push(simplify(pts))
  }
  return loops
}

/** Drops points on straight runs. */
function simplify(pts: number[]): number[] {
  const out: number[] = []
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const [ax, ay] = [pts[((i - 1 + n) % n) * 2], pts[((i - 1 + n) % n) * 2 + 1]]
    const [bx, by] = [pts[i * 2], pts[i * 2 + 1]]
    const [cx, cy] = [pts[((i + 1) % n) * 2], pts[((i + 1) % n) * 2 + 1]]
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) out.push(bx, by)
  }
  return out
}
