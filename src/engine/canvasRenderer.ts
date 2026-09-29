// What the canvas draws each frame. Panning and zooming don't change the document, so they don't composite it:
// the document is flattened once, at the detail the zoom needs, and each frame only places that image. Editing
// does change it, and composites into the view directly (keeping the backdrop under the edited layer).

import type { Manifest } from '../model/manifest'
import type { AssetStore, Compositor, View } from './compositor'
import { mipLevels, Program, type Target } from './gl'
import { FULLSCREEN_VS, PRESENT_CACHE_FS } from './shaders'

/** Largest flattened image kept for navigating, in pixels (4096², 64 MB with its mipmaps' share). */
const CACHE_PIXELS = 4096 * 4096

interface DocumentCache {
  doc: Manifest
  assets: AssetStore
  level: number
  scale: number
  target: Target
}

export type FramePath = 'cache' | 'cache-build' | 'screen'

export class CanvasRenderer {
  private program: Program
  private vao: WebGLVertexArrayObject
  private cache: DocumentCache | null = null
  private lastDoc: Manifest | null = null
  private lastAssets: AssetStore | null = null
  lastPath: FramePath = 'screen'

  constructor(readonly compositor: Compositor) {
    const gl = compositor.gl
    this.program = new Program(gl, FULLSCREEN_VS, PRESENT_CACHE_FS)
    this.program.use().int('uCache', 0)
    this.vao = gl.createVertexArray()!
  }

  /** Halvings of the document the view can afford: 0 at 50% zoom and above, 1 from 25%, and so on. */
  static level(scale: number) {
    return Math.max(0, Math.floor(Math.log2(1 / scale)))
  }

  frame(doc: Manifest, assets: AssetStore, width: number, height: number, view: View): FramePath {
    const navigating = doc === this.lastDoc && assets === this.lastAssets
    this.lastDoc = doc
    this.lastAssets = assets
    if (navigating) {
      const needed = CanvasRenderer.level(view.scale)
      let cache: DocumentCache | null = this.cache
      let path: FramePath = 'cache'
      // A more detailed cache than needed still serves, reduced through its mipmaps.
      if (!cache || cache.doc !== doc || cache.assets !== assets || cache.level > needed) {
        cache = this.build(doc, assets, needed)
        path = 'cache-build'
      }
      if (cache) {
        this.present(cache, doc, width, height, view)
        return (this.lastPath = path)
      }
    }
    const result = this.compositor.composite(doc, assets, width, height, view, 'screen')
    this.compositor.present(result, doc, view)
    return (this.lastPath = 'screen')
  }

  private build(doc: Manifest, assets: AssetStore, level: number): DocumentCache | null {
    const scale = 2 ** -level
    const w = Math.ceil(doc.width * scale), h = Math.ceil(doc.height * scale)
    const max = this.compositor.maxTextureSize
    // Too large for one image at this detail: the view composites directly instead (tiles come later).
    if (w * h > CACHE_PIXELS || w > max || h > max) return (this.cache = null)
    const target = this.compositor.composite(doc, assets, w, h, { scale, x: 0, y: 0 }, 'document', mipLevels(w, h))
    return (this.cache = { doc, assets, level, scale, target })
  }

  private present(cache: DocumentCache, doc: Manifest, width: number, height: number, view: View) {
    const gl = this.compositor.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, cache.target.texture)
    this.program
      .use()
      .vec2('uTargetSize', width, height)
      .vec2('uDocSize', doc.width, doc.height)
      .vec2('uUvScale', cache.scale / cache.target.width, cache.scale / cache.target.height)
      .float('uChecker', 8 * (globalThis.devicePixelRatio || 1))
    gl.uniform3f(this.program.loc('uView'), view.scale, view.x, view.y)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
