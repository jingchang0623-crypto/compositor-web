// The WebGL2 compositor: layers stay on the GPU as textures, and a frame composites them bottom to top into a pair of
// target-sized surfaces, one pass per layer (the pass reads the backdrop and writes the result, then they swap).

import type { Adjustment, LayerRecord, LayerTransform, Manifest, Sampling } from '../model/manifest'
import { BLEND_MODES } from '../model/manifest'
import { invert3, renderList, unitToDocument, type DrawStep } from '../model/renderList'
import { adjustmentTable } from './adjustments'
import { mipLevels, mul3, Program, Target } from './gl'
import { FULLSCREEN_VS, KIND, LAYER_FS, MAX_MASKS, PRESENT_FS } from './shaders'

/** Decoded pixels: an ImageBitmap (premultiplied RGBA, or gray for a mask), or raw bytes of the same. */
export type PixelSource = ImageBitmap | { width: number; height: number; data: Uint8Array }

/** Where a document's images come from, by file name inside `images/`. */
export interface AssetStore {
  get(file: string): PixelSource | undefined
}

/** Document pixels → target pixels. */
export interface View {
  scale: number
  x: number
  y: number
}

const UNIT = { backdrop: 0, layer: 1, mask: 2, lut: 6, cube: 7 } as const

interface TableTexture {
  kind: number
  texture: WebGLTexture
  size: number
}

export class Compositor {
  readonly gl: WebGL2RenderingContext
  readonly maxTextureSize: number
  private layerProgram: Program
  private presentProgram: Program
  private vao: WebGLVertexArrayObject
  private textures = new Map<PixelSource, { texture: WebGLTexture; bytes: number }>()
  private tables = new Map<string, TableTexture | null>()
  private ping = new Map<string, [Target, Target]>()
  private memo = new Map<string, Memo>()
  /** Bound for reading while a pass draws into the surface that would otherwise be there. */
  private blank: WebGLTexture
  /** Bytes held in layer and mask textures, including their mipmaps. */
  textureBytes = 0
  /** Passes drawn by the last `composite`. */
  lastPasses = 0

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available in this browser.')
    this.gl = gl
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    // Half-float tables are filterable in WebGL2 without an extension.
    this.layerProgram = new Program(gl, FULLSCREEN_VS, LAYER_FS)
    this.presentProgram = new Program(gl, FULLSCREEN_VS, PRESENT_FS)
    this.vao = gl.createVertexArray()!
    // Every sampler on its own unit: a 2D and a 3D sampler sharing a unit is an error even when one is unused.
    const p = this.layerProgram.use()
    p.int('uBackdrop', UNIT.backdrop).int('uLayer', UNIT.layer).int('uLut', UNIT.lut).int('uCube', UNIT.cube)
    for (let i = 0; i < MAX_MASKS; i++) p.int(`uMask${i}`, UNIT.mask + i)
    this.presentProgram.use().int('uComposite', 0)
    this.blank = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.blank)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  }

  // MARK: Textures

  /** The GPU copy of `source`, uploaded on first use with mipmaps for zooming out. */
  texture(source: PixelSource, mask: boolean, sampling: Sampling = 'High quality'): WebGLTexture {
    const gl = this.gl
    let texture = this.textures.get(source)?.texture
    if (!texture) {
      texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      const levels = mipLevels(source.width, source.height)
      gl.texStorage2D(gl.TEXTURE_2D, levels, mask ? gl.R8 : gl.RGBA8, source.width, source.height)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      // Layer pixels are premultiplied, as upstream keeps them; masks are gray values and must stay as they are.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !mask)
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      const format = mask ? gl.RED : gl.RGBA
      if ('data' in source) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false) // Raw bytes arrive premultiplied already.
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, source.width, source.height, format, gl.UNSIGNED_BYTE, source.data)
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, source.width, source.height, format, gl.UNSIGNED_BYTE, source)
      }
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const bytes = Math.round(source.width * source.height * (mask ? 1 : 4) * (4 / 3))
      this.textures.set(source, { texture, bytes })
      this.textureBytes += bytes
    }
    gl.bindTexture(gl.TEXTURE_2D, texture)
    const nearest = sampling === 'Nearest'
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR)
    return texture
  }

  /** Lets go of every texture made from a source not in `keep`. */
  retainOnly(keep: Set<PixelSource>) {
    for (const [source, held] of this.textures) {
      if (keep.has(source)) continue
      this.gl.deleteTexture(held.texture)
      this.textures.delete(source)
      this.textureBytes -= held.bytes
    }
  }

  private table(adjustment: Adjustment): TableTexture | null {
    const key = JSON.stringify(adjustment)
    if (this.tables.has(key)) return this.tables.get(key)!
    const table = adjustmentTable(adjustment)
    let made: TableTexture | null = null
    const gl = this.gl
    if (table?.kind === 'channels') {
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, table.rgb)
      setLinearClamp(gl, gl.TEXTURE_2D)
      made = { kind: KIND.channels, texture, size: 256 }
    } else if (table?.kind === 'cube') {
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_3D, texture)
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, table.size, table.size, table.size, 0, gl.RGBA, gl.FLOAT, table.data)
      setLinearClamp(gl, gl.TEXTURE_3D)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
      made = { kind: KIND.cube, texture, size: table.size }
    }
    // Slider drags make a table per value: let the oldest go, texture and all.
    while (this.tables.size >= 64) {
      const [oldest, held] = this.tables.entries().next().value!
      if (held) this.gl.deleteTexture(held.texture)
      this.tables.delete(oldest)
    }
    this.tables.set(key, made)
    return made
  }

  // MARK: Compositing

  /** A pair of surfaces per purpose, so an offscreen render doesn't throw away the screen's. */
  private surfaces(width: number, height: number, purpose: string, levels = 1): [Target, Target] {
    let pair = this.ping.get(purpose)
    if (!pair || pair[0].width !== width || pair[0].height !== height || pair[0].levels !== levels) {
      pair?.forEach((t) => t.dispose())
      pair = [new Target(this.gl, width, height, levels), new Target(this.gl, width, height, levels)]
      this.ping.set(purpose, pair)
      this.memo.delete(purpose)
    }
    return pair
  }

  releaseSurfaces(purpose: string) {
    this.ping.get(purpose)?.forEach((t) => t.dispose())
    this.ping.delete(purpose)
    const memo = this.memo.get(purpose)
    memo?.snapshot?.dispose()
    this.memo.delete(purpose)
  }

  /**
   * Composites `doc` into a `width`×`height` surface placed by `view`, and returns that surface.
   *
   * Two shortcuts keep repeated frames cheap. A frame identical to the last one for this purpose draws nothing.
   * And when only some layers changed — a slider dragged on one of them — the backdrop below the first changed layer
   * is kept from the frame before, so only that layer and the ones above it are composited again.
   */
  composite(doc: Manifest, assets: AssetStore, width: number, height: number, view: View, purpose = 'screen', levels = 1): Target {
    const gl = this.gl
    let [src, dst] = this.surfaces(width, height, purpose, levels)
    const viewMatrix = new Float32Array([view.scale, 0, 0, 0, view.scale, 0, view.x, view.y, 1])
    const place = (t: LayerTransform) => mul3(viewMatrix, unitToDocument(t))
    const steps = renderList(doc).filter((step) => overlaps(place(step.layer.transform), width, height))
    const signatures = steps.map((step) => signature(step, assets))
    const key = `${view.scale},${view.x},${view.y}`

    // How much of the last frame still holds.
    const memo = this.memo.get(purpose)
    let first = 0
    if (memo && memo.key === key) {
      const n = Math.min(memo.signatures.length, signatures.length)
      while (first < n && sameStep(memo.signatures[first], signatures[first])) first++
      if (first === n && memo.signatures.length === signatures.length) {
        this.lastPasses = 0
        return memo.result
      }
    }
    let start = 0
    if (memo?.snapshot && memo.key === key && memo.snapshotIndex > 0 && memo.snapshotIndex <= first) {
      start = memo.snapshotIndex
      blit(gl, memo.snapshot, src)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, src.framebuffer)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    const next: Memo = { key, signatures, result: src, snapshot: memo?.snapshot, snapshotIndex: memo?.snapshotIndex ?? 0 }
    if (memo && memo.key !== key) next.snapshotIndex = 0 // Its pixels belong to another view.

    gl.viewport(0, 0, width, height)
    gl.bindVertexArray(this.vao)
    const p = this.layerProgram.use()
    p.vec2('uTargetSize', width, height)
    let passes = 0

    for (let i = start; i < steps.length; i++) {
      const step = steps[i]
      // Keep the backdrop under the first changed layer, so the next frame of the same edit can start there.
      if (i === first && memo && memo.key === key && i > 0 && i !== next.snapshotIndex) {
        if (!next.snapshot || next.snapshot.width !== width || next.snapshot.height !== height) {
          next.snapshot?.dispose()
          next.snapshot = new Target(gl, width, height)
        }
        blit(gl, src, next.snapshot)
        next.snapshotIndex = i
      }
      const { layer } = step
      const toTarget = place(layer.transform)

      let kind: number = KIND.pixels
      if (layer.imageFile) {
        const source = assets.get(layer.imageFile)
        if (!source) continue
        gl.activeTexture(gl.TEXTURE0 + UNIT.layer)
        this.texture(source, false, layer.transform.sampling)
      } else if (layer.adjustment) {
        const table = this.table(layer.adjustment)
        if (!table) continue // Not drawn on the web yet: the backdrop passes through unchanged.
        kind = table.kind
        gl.activeTexture(gl.TEXTURE0 + (kind === KIND.cube ? UNIT.cube : UNIT.lut))
        gl.bindTexture(kind === KIND.cube ? gl.TEXTURE_3D : gl.TEXTURE_2D, table.texture)
        p.float('uCubeSize', table.size)
      }

      // The layer's own mask (linked: its transform; unlinked: its own placement), then each enclosing folder's.
      const masks: { file: string; placement: LayerTransform }[] = []
      if (layer.maskFile && layer.maskEnabled !== false)
        masks.push({
          file: layer.maskFile,
          placement: layer.maskLinked === false && layer.maskPlacement ? layer.maskPlacement : layer.transform,
        })
      for (const folder of step.folderMasks) masks.push({ file: folder.maskFile!, placement: folder.transform })
      let maskCount = 0
      for (const mask of masks.slice(0, MAX_MASKS)) {
        const source = assets.get(mask.file)
        if (!source) continue
        gl.activeTexture(gl.TEXTURE0 + UNIT.mask + maskCount)
        this.texture(source, true)
        p.mat3(`uToMask${maskCount}`, invert3(place(mask.placement)))
        maskCount++
      }

      p.int('uKind', kind)
        .int('uMode', Math.max(0, BLEND_MODES.indexOf(step.blendMode)))
        .float('uOpacity', step.opacity)
        .mat3('uToUnit', invert3(toTarget))
        .vec2('uUnitPx', Math.hypot(toTarget[0], toTarget[1]), Math.hypot(toTarget[3], toTarget[4]))
        .int('uMaskCount', maskCount)

      // Normal pixels are plain source-over: the blending hardware draws them in place, over just the layer's
      // bounds, without reading the backdrop or swapping surfaces.
      const direct = kind === KIND.pixels && step.blendMode === 'Normal'
      gl.activeTexture(gl.TEXTURE0 + UNIT.backdrop)
      if (direct) {
        gl.bindTexture(gl.TEXTURE_2D, this.blank) // The surface being drawn into can't also be bound for reading.
        gl.bindFramebuffer(gl.FRAMEBUFFER, src.framebuffer)
        const [x0, y0, x1, y1] = bounds(toTarget, width, height)
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(x0, height - y1, x1 - x0, y1 - y0)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        p.int('uDirect', 1)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.disable(gl.BLEND)
        gl.disable(gl.SCISSOR_TEST)
        p.int('uDirect', 0)
      } else {
        gl.bindTexture(gl.TEXTURE_2D, src.texture)
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        ;[src, dst] = [dst, src]
      }
      passes++
    }
    if (levels > 1) {
      gl.bindTexture(gl.TEXTURE_2D, src.texture)
      gl.generateMipmap(gl.TEXTURE_2D)
    }
    next.result = src
    this.memo.set(purpose, next)
    this.lastPasses = passes
    return src
  }

  /** Draws a composite onto the canvas, over a checkerboard, with the pasteboard around the document. */
  present(result: Target, doc: { width: number; height: number }, view: View) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, result.width, result.height)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, result.texture)
    this.presentProgram
      .use()
      .vec2('uTargetSize', result.width, result.height)
      .vec4('uDocRect', view.x, view.y, view.x + doc.width * view.scale, view.y + doc.height * view.scale)
      .float('uChecker', 8 * (globalThis.devicePixelRatio || 1))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Waits until the GPU has finished everything asked of it so far (a one-pixel read), for timing. */
  finish() {
    const gl = this.gl
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  }

  get renderer(): string {
    return String(this.gl.getParameter(this.gl.RENDERER))
  }

  /** A surface's pixels, premultiplied RGBA, top row first. */
  read(target: Target): Uint8Array {
    const gl = this.gl
    const { width, height } = target
    const bottomUp = new Uint8Array(width * height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp)
    const out = new Uint8Array(bottomUp.length)
    const row = width * 4
    for (let y = 0; y < height; y++) out.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row)
    return out
  }
}

function setLinearClamp(gl: WebGL2RenderingContext, target: number) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
}

/** Whether the unit square, placed by `m`, touches the target at all. */
function overlaps(m: Float32Array, width: number, height: number) {
  const xs: number[] = [], ys: number[] = []
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    xs.push(m[0] * u + m[3] * v + m[6])
    ys.push(m[1] * u + m[4] * v + m[7])
  }
  return Math.max(...xs) > 0 && Math.min(...xs) < width && Math.max(...ys) > 0 && Math.min(...ys) < height
}

interface StepSignature {
  layer: LayerRecord
  opacity: number
  blendMode: string
  sources: (PixelSource | undefined)[]
  folders: LayerRecord[]
}
interface Memo {
  key: string
  signatures: StepSignature[]
  result: Target
  snapshot?: Target
  /** The backdrop in `snapshot` is the one under this step. */
  snapshotIndex: number
}

function signature(step: DrawStep, assets: AssetStore): StepSignature {
  const { layer } = step
  const files = [layer.imageFile, layer.maskFile, ...step.folderMasks.map((f) => f.maskFile)]
  return {
    layer, opacity: step.opacity, blendMode: step.blendMode, folders: step.folderMasks,
    sources: files.map((f) => (f ? assets.get(f) : undefined)),
  }
}

function sameStep(a: StepSignature, b: StepSignature) {
  return a.layer === b.layer && a.opacity === b.opacity && a.blendMode === b.blendMode
    && a.sources.length === b.sources.length && a.sources.every((s, i) => s === b.sources[i])
    && a.folders.length === b.folders.length && a.folders.every((f, i) => f === b.folders[i])
}

function blit(gl: WebGL2RenderingContext, from: Target, to: Target) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.framebuffer)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.framebuffer)
  gl.blitFramebuffer(0, 0, from.width, from.height, 0, 0, to.width, to.height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
}

/** The unit square placed by `m`, as whole target pixels (x0, y0, x1, y1, y down), clipped to the target. */
function bounds(m: Float32Array, width: number, height: number): [number, number, number, number] {
  const xs: number[] = [], ys: number[] = []
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    xs.push(m[0] * u + m[3] * v + m[6])
    ys.push(m[1] * u + m[4] * v + m[7])
  }
  const clampTo = (n: number, hi: number) => Math.min(hi, Math.max(0, n))
  return [
    clampTo(Math.floor(Math.min(...xs)) - 1, width), clampTo(Math.floor(Math.min(...ys)) - 1, height),
    clampTo(Math.ceil(Math.max(...xs)) + 1, width), clampTo(Math.ceil(Math.max(...ys)) + 1, height),
  ]
}
