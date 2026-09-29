// Changing pixels on the GPU: brush strokes, and fills or clears through a selection. A stroke paints soft dabs into a
// coverage texture; each frame, the dirty part of a live copy of the layer is recomposed as its original pixels plus
// color × coverage × opacity (upstream BrushStroke.swift: coverage builds within a stroke, opacity caps it). When the
// stroke ends, only the tiles it touched are read back, and the live texture becomes the new pixels' texture.

import type { Compositor, PixelSource } from './compositor'
import { mipLevels, Program } from './gl'
import { RasterSource, TILE, type GpuSource } from './raster'

const QUAD_VS = /* glsl */ `#version 300 es
uniform vec4 uRect;   // x0, y0, x1, y1 in target pixels (row 0 is the image's top row)
uniform vec2 uSize;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1);
  vec2 p = mix(uRect.xy, uRect.zw, corner);
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}
`

// One dab's coverage: 1 inside radius × hardness, then upstream's falloff to 0 at the radius; hard tips get a 1-pixel
// antialiased edge instead.
const DAB_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uRadius;   // in target pixels, per axis (a scaled layer paints an ellipse)
uniform float uHardness;
out vec4 outColor;
void main() {
  vec2 d = (gl_FragCoord.xy - uCenter) / uRadius;
  float r = length(d);
  float c;
  if (uHardness >= 1.0) {
    c = clamp((1.0 - r) * min(uRadius.x, uRadius.y) + 0.5, 0.0, 1.0);
  } else {
    float u = clamp((r - uHardness) / max(1e-4, 1.0 - uHardness), 0.0, 1.0);
    float e = exp(-2.5);
    c = r <= uHardness ? 1.0 : max(0.0, (exp(-2.5 * u * u) - e) / (1.0 - e));
  }
  outColor = vec4(c, c, c, c);
}
`

const COMPOSE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uCoverage;
uniform sampler2D uSelection;
uniform bool uFull;        // coverage 1 everywhere (fills and clears), rather than the stroke's
uniform bool uUseSelection;
uniform mat3 uToSelection; // target pixel → selection texture coordinates
uniform int uMode;         // 0 paint color, 1 erase, 2 set a mask value
uniform vec3 uColor;       // straight sRGB; for masks, .r is the value
uniform float uOpacity;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 base = texelFetch(uBase, p, 0);
  float a = (uFull ? 1.0 : texelFetch(uCoverage, p, 0).r) * uOpacity;
  if (uUseSelection) {
    vec2 uv = (uToSelection * vec3(gl_FragCoord.xy, 1.0)).xy;
    a *= (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture(uSelection, uv).r;
  }
  if (uMode == 0) outColor = vec4(uColor * a, a) + base * (1.0 - a);
  else if (uMode == 1) outColor = base * (1.0 - a);
  else outColor = vec4(mix(base.r, uColor.r, a));
}
`

export type PaintMode = 'paint' | 'erase' | 'mask'

export interface PaintTarget {
  /** The pixels as they are now; a 1×1 mask or no pixels at all (null) are made full size first. */
  source: PixelSource | null
  width: number
  height: number
  mask: boolean
  /** A missing or 1×1 source is this value everywhere (0 transparent, or a mask's gray). */
  fill: number
}

export interface PaintOptions {
  mode: PaintMode
  color: [number, number, number]
  opacity: number
  /** Coverage (0–255) over the canvas, and how to find it from a target pixel. */
  selection?: { texture: WebGLTexture; toSelection: Float32Array }
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

export class PaintEngine {
  private dab: Program
  private compose: Program
  private vao: WebGLVertexArrayObject

  constructor(readonly compositor: Compositor) {
    const gl = compositor.gl
    this.dab = new Program(gl, QUAD_VS, DAB_FS)
    this.compose = new Program(gl, QUAD_VS, COMPOSE_FS)
    this.compose.use().int('uBase', 0).int('uCoverage', 1).int('uSelection', 2)
    this.vao = gl.createVertexArray()!
  }

  /** A selection as an R8 texture over the canvas, made once per selection mask. */
  selectionTexture(coverage: Uint8Array, width: number, height: number): WebGLTexture {
    const gl = this.compositor.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, coverage)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  begin(target: PaintTarget, options: PaintOptions): Stroke {
    return new Stroke(this, target, options)
  }

  /** @internal */ draw(program: Program, fb: WebGLFramebuffer, width: number, height: number, rect: Rect) {
    const gl = this.compositor.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.viewport(0, 0, width, height)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0)
    gl.bindVertexArray(this.vao)
    program.vec2('uSize', width, height).vec4('uRect', rect.x0, rect.y0, rect.x1, rect.y1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disable(gl.SCISSOR_TEST)
  }

  /** @internal */ get programs() { return { dab: this.dab, compose: this.compose } }
}

function texture(gl: WebGL2RenderingContext, w: number, h: number, format: number, levels = 1): { tex: WebGLTexture; fb: WebGLFramebuffer } {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texStorage2D(gl.TEXTURE_2D, levels, format, w, h)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fb = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fb }
}

export class Stroke {
  private live: { tex: WebGLTexture; fb: WebGLFramebuffer }
  private coverage: { tex: WebGLTexture; fb: WebGLFramebuffer } | null = null
  private base: WebGLTexture
  private ownsBase = false
  /** Everything changed so far, and what changed since the last recompose. */
  private dirty: Rect | null = null
  private pending: Rect | null = null
  private finished = false

  constructor(private engine: PaintEngine, readonly target: PaintTarget, private options: PaintOptions) {
    const gl = engine.compositor.gl
    const { width: w, height: h, mask } = target
    const format = mask ? gl.R8 : gl.RGBA8
    // The live copy has room for mipmaps, so it can become the committed pixels' texture without an upload.
    this.live = texture(gl, w, h, format, mipLevels(w, h))
    const full = target.source && target.source.width === w && target.source.height === h
    if (full) {
      this.base = engine.compositor.texture(target.source!, mask)
      // live ← base, level 0 of each.
      const read = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read)
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.base, 0)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.live.fb)
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.deleteFramebuffer(read)
    } else {
      // A missing or uniform source: its one value, everywhere, at full size.
      const v = target.fill / 255
      const made = texture(gl, w, h, format)
      for (const fb of [made.fb, this.live.fb]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
        gl.clearColor(v, v, v, mask ? v : target.fill ? v : 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
      gl.deleteFramebuffer(made.fb)
      this.base = made.tex
      this.ownsBase = true
    }
  }

  private grow(r: Rect) {
    const clip = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
    const c = { x0: clip(Math.floor(r.x0), this.target.width), y0: clip(Math.floor(r.y0), this.target.height), x1: clip(Math.ceil(r.x1), this.target.width), y1: clip(Math.ceil(r.y1), this.target.height) }
    if (c.x1 <= c.x0 || c.y1 <= c.y0) return
    const merge = (a: Rect | null) => (a ? { x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) } : c)
    this.dirty = merge(this.dirty)
    this.pending = merge(this.pending)
  }

  /** One dab, at (`x`, `y`) in target pixels, `rx`×`ry` pixels in radius. */
  dab(x: number, y: number, rx: number, ry: number, hardness: number) {
    const gl = this.engine.compositor.gl
    if (!this.coverage) {
      this.coverage = texture(gl, this.target.width, this.target.height, gl.R8)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.coverage.fb)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    const rect = { x0: x - rx - 1, y0: y - ry - 1, x1: x + rx + 1, y1: y + ry + 1 }
    const { dab } = this.engine.programs
    dab.use().vec2('uCenter', x, y).vec2('uRadius', Math.max(0.5, rx), Math.max(0.5, ry)).float('uHardness', hardness)
    gl.enable(gl.BLEND)
    // Coverage builds up within the stroke: the lighter of the two for hard tips, screen for soft (upstream).
    if (hardness >= 1) { gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE) }
    else { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR) }
    this.engine.draw(dab, this.coverage.fb, this.target.width, this.target.height, this.clipRect(rect))
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.BLEND)
    this.grow(rect)
  }

  /** Coverage 1 over the whole target (clipped by the selection): a fill or a clear. */
  fillAll() {
    this.grow({ x0: 0, y0: 0, x1: this.target.width, y1: this.target.height })
    this.recompose(true)
  }

  private clipRect(r: Rect): Rect {
    return {
      x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)),
      x1: Math.min(this.target.width, Math.ceil(r.x1)), y1: Math.min(this.target.height, Math.ceil(r.y1)),
    }
  }

  /** Brings the live pixels up to date with the dabs so far, over just what they touched. */
  recompose(full = false) {
    const r = this.pending
    if (!r) return
    this.pending = null
    const gl = this.engine.compositor.gl
    const { compose } = this.engine.programs
    const o = this.options
    compose.use()
      .int('uFull', full ? 1 : 0)
      .int('uMode', o.mode === 'paint' ? 0 : o.mode === 'erase' ? 1 : 2)
      .float('uOpacity', o.opacity)
      .int('uUseSelection', o.selection ? 1 : 0)
    gl.uniform3f(compose.loc('uColor'), ...o.color)
    if (o.selection) compose.mat3('uToSelection', o.selection.toSelection)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.base)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.coverage?.tex ?? this.base)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, o.selection?.texture ?? this.base)
    gl.activeTexture(gl.TEXTURE0)
    this.engine.draw(compose, this.live.fb, this.target.width, this.target.height, r)
  }

  /** What to draw while the stroke is going: a fresh object each frame, so the renderer sees the change. */
  preview(): GpuSource {
    this.recompose()
    return { width: this.target.width, height: this.target.height, texture: this.live.tex, mask: this.target.mask }
  }

  get changed() { return !!this.dirty }

  /**
   * The stroke's result as tiles: the ones it touched read back and the rest shared with the old pixels (all of them
   * read back when the old pixels weren't tiles of this size). The live texture becomes the result's texture.
   */
  finish(): RasterSource | null {
    if (this.finished) return null
    this.finished = true
    this.recompose()
    const gl = this.engine.compositor.gl
    const { width: w, height: h, mask } = this.target
    const channels = mask ? 1 : 4
    let result: RasterSource | null = null
    if (this.dirty) {
      const prior = this.target.source
      const reuse = prior instanceof RasterSource && prior.width === w && prior.height === h && prior.channels === channels
      const d = reuse
        ? { x0: Math.floor(this.dirty.x0 / TILE) * TILE, y0: Math.floor(this.dirty.y0 / TILE) * TILE, x1: Math.min(w, Math.ceil(this.dirty.x1 / TILE) * TILE), y1: Math.min(h, Math.ceil(this.dirty.y1 / TILE) * TILE) }
        : { x0: 0, y0: 0, x1: w, y1: h }
      const pixels = this.engine.compositor.readTexture(this.live.tex, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, mask)
      const fill = mask ? this.target.fill : 0
      result = reuse
        ? (prior as RasterSource).withRegion(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, pixels)
        : RasterSource.fromPixels(w, h, channels, pixels, fill)
      gl.bindTexture(gl.TEXTURE_2D, this.live.tex)
      this.engine.compositor.adopt(result, this.live.tex)
    } else gl.deleteTexture(this.live.tex)
    gl.deleteFramebuffer(this.live.fb)
    if (this.coverage) { gl.deleteTexture(this.coverage.tex); gl.deleteFramebuffer(this.coverage.fb) }
    if (this.ownsBase) gl.deleteTexture(this.base)
    return result
  }

  /** Throws the stroke away (Escape), leaving the old pixels as they were. */
  cancel() {
    if (this.finished) return
    this.finished = true
    const gl = this.engine.compositor.gl
    gl.deleteTexture(this.live.tex)
    gl.deleteFramebuffer(this.live.fb)
    if (this.coverage) { gl.deleteTexture(this.coverage.tex); gl.deleteFramebuffer(this.coverage.fb) }
    if (this.ownsBase) gl.deleteTexture(this.base)
  }
}
