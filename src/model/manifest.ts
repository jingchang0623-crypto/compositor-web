// The `.comp` manifest, versions 1–11, as the desktop app writes it (upstream IO/ProjectStore.swift and
// docs/project-format.md). The web app keeps this shape as its document model, so a project opens and saves
// without translation.

export const FORMAT = 'com.compositor.project'
export const CURRENT_VERSION = 11

/** Photoshop's order, grouped as the blend menu groups them. */
export const BLEND_GROUPS = [
  ['Normal'],
  ['Darken', 'Multiply', 'Color Burn', 'Linear Burn'],
  ['Lighten', 'Screen', 'Color Dodge', 'Linear Dodge (Add)'],
  ['Overlay', 'Soft Light', 'Hard Light', 'Vivid Light', 'Linear Light', 'Pin Light', 'Hard Mix'],
  ['Difference', 'Exclusion', 'Subtract', 'Divide'],
  ['Hue', 'Saturation', 'Color', 'Luminosity'],
] as const
export type BlendMode = (typeof BLEND_GROUPS)[number][number]
export const BLEND_MODES: readonly BlendMode[] = BLEND_GROUPS.flat()

export type Sampling = 'High quality' | 'Smooth' | 'Nearest'

export interface LayerTransform {
  /** Top-left corner in document pixels, before rotation. */
  origin: [number, number]
  size: [number, number]
  /** Degrees, clockwise, about the rectangle's center. */
  rotation: number
  flipX: boolean
  flipY: boolean
  sampling: Sampling
}

export interface LevelRange {
  black: number
  gamma: number
  white: number
  outputBlack: number
  outputWhite: number
}
export interface CurvePoint {
  x: number
  y: number
}
export interface ExposureSettings {
  exposure: number
  offset: number
  gamma: number
}

export const ADJUSTMENT_KINDS = [
  'Hue/Saturation', 'Levels', 'Curves', 'Exposure', 'Gradient Map', 'Grain', 'Invert', 'Black & White',
  'Color Balance', 'Gaussian Blur', 'Motion Blur', 'Add Noise',
] as const
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number]

export interface Adjustment {
  kind: AdjustmentKind
  hue?: number
  saturation?: number
  lightness?: number
  colorize?: boolean
  levels?: { channel: string; ranges: LevelRange[] }
  curves?: { channel: string; channels: CurvePoint[][] }
  exposureSettings?: ExposureSettings
  /** Settings for kinds the web engine doesn't draw yet are kept as they are, so a save round-trips them. */
  [key: string]: unknown
}

export interface LayerRecord {
  id: string
  name: string
  isVisible: boolean
  transform: LayerTransform
  imageFile?: string
  parentID?: string
  isGroup?: boolean
  opacity?: number
  blendMode?: BlendMode
  maskFile?: string
  maskEnabled?: boolean
  maskSourceID?: string
  adjustment?: Adjustment
  maskPlacement?: LayerTransform
  maskLinked?: boolean
  shape?: unknown
  text?: unknown
  effects?: unknown
}

export interface Manifest {
  format: string
  version: number
  colorSpace: string
  documentID: string
  width: number
  height: number
  resolution?: number
  activeLayerID?: string
  /** Bottom to top. */
  layers: LayerRecord[]
  guides?: unknown[]
}

export class ManifestError extends Error {}

const MAX_SIDE = 30_000
const MAX_LAYERS = 10_000
const MAX_DEPTH = 64

function fail(reason: string): never {
  throw new ManifestError(reason)
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function checkTransform(t: unknown, where: string): LayerTransform {
  const r = t as LayerTransform
  if (!r || !Array.isArray(r.origin) || !Array.isArray(r.size)) fail(`${where}: transform is missing origin or size`)
  const [x, y] = r.origin, [w, h] = r.size
  if (![x, y, w, h, r.rotation ?? 0].every(finite)) fail(`${where}: transform has a non-finite value`)
  if (w < 1 || h < 1 || w > 300_000 || h > 300_000) fail(`${where}: transform size out of range`)
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) fail(`${where}: transform origin out of range`)
  return {
    origin: [x, y],
    size: [w, h],
    rotation: r.rotation ?? 0,
    flipX: r.flipX ?? false,
    flipY: r.flipY ?? false,
    sampling: r.sampling ?? 'High quality',
  }
}

/**
 * Validates a manifest the way the desktop app does before it replaces the open document: anything it would refuse
 * is refused here too, with the reason (the desktop app refuses silently).
 */
export function parseManifest(json: unknown): Manifest {
  const m = json as Manifest
  if (!m || typeof m !== 'object') fail('manifest is not an object')
  if (m.format !== FORMAT) fail(`format is "${String(m.format)}", expected "${FORMAT}"`)
  if (!Number.isInteger(m.version) || m.version < 1 || m.version > CURRENT_VERSION)
    fail(`version ${String(m.version)} is not supported (1–${CURRENT_VERSION})`)
  if (m.colorSpace !== undefined && m.colorSpace !== 'sRGB') fail(`color space "${m.colorSpace}" is not sRGB`)
  for (const side of [m.width, m.height])
    if (!Number.isInteger(side) || side < 1 || side > MAX_SIDE) fail(`canvas side ${String(side)} out of range`)
  if (!Array.isArray(m.layers)) fail('layers is not an array')
  if (m.layers.length > MAX_LAYERS) fail(`more than ${MAX_LAYERS} layers`)

  const byID = new Map<string, LayerRecord>()
  const layers = m.layers.map((raw, index) => {
    const where = `layer ${index} (${raw?.name ?? '?'})`
    if (typeof raw?.id !== 'string' || !raw.id) fail(`${where}: missing id`)
    if (byID.has(raw.id)) fail(`${where}: duplicate id ${raw.id}`)
    if (raw.imageFile !== undefined && raw.imageFile !== `${raw.id}.png`)
      fail(`${where}: imageFile must be "${raw.id}.png"`)
    if (raw.maskFile !== undefined && raw.maskFile !== `${raw.id}.mask.png`)
      fail(`${where}: maskFile must be "${raw.id}.mask.png"`)
    if (raw.isGroup && raw.imageFile) fail(`${where}: a folder cannot have an image`)
    if (raw.blendMode !== undefined && !BLEND_MODES.includes(raw.blendMode))
      fail(`${where}: unknown blend mode "${raw.blendMode}"`)
    if (raw.opacity !== undefined && (!finite(raw.opacity) || raw.opacity < 0 || raw.opacity > 1))
      fail(`${where}: opacity out of range`)
    if (raw.adjustment && !ADJUSTMENT_KINDS.includes(raw.adjustment.kind))
      fail(`${where}: unknown adjustment "${raw.adjustment.kind}"`)
    const layer: LayerRecord = {
      ...raw,
      transform: checkTransform(raw.transform, where),
      maskPlacement: raw.maskPlacement ? checkTransform(raw.maskPlacement, `${where} mask`) : undefined,
    }
    byID.set(layer.id, layer)
    return layer
  })

  for (const layer of layers) {
    let depth = 0
    for (let parent = layer.parentID; parent !== undefined; parent = byID.get(parent)?.parentID) {
      const group = byID.get(parent)
      if (!group) fail(`${layer.name}: parent ${parent} does not exist`)
      if (!group.isGroup) fail(`${layer.name}: parent ${group.name} is not a folder`)
      if (++depth > MAX_DEPTH) fail(`${layer.name}: nested too deep or in a cycle`)
    }
    if (layer.maskSourceID !== undefined && !byID.has(layer.maskSourceID))
      fail(`${layer.name}: clipping source ${layer.maskSourceID} does not exist`)
  }

  return { ...m, colorSpace: 'sRGB', resolution: m.resolution ?? 72, layers }
}

export function newID(): string {
  return crypto.randomUUID().toUpperCase()
}

export function fullCanvasTransform(width: number, height: number): LayerTransform {
  return { origin: [0, 0], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' }
}
