// Small WebGL2 helpers: programs with cached uniform locations, and render targets.

export class Program {
  readonly program: WebGLProgram
  private locations = new Map<string, WebGLUniformLocation | null>()

  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(shader)}`)
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Program failed to link: ${gl.getProgramInfoLog(program)}`)
    this.program = program
  }

  use() {
    this.gl.useProgram(this.program)
    return this
  }
  loc(name: string) {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name))
    return this.locations.get(name)!
  }
  int(name: string, v: number) { this.gl.uniform1i(this.loc(name), v); return this }
  float(name: string, v: number) { this.gl.uniform1f(this.loc(name), v); return this }
  vec2(name: string, x: number, y: number) { this.gl.uniform2f(this.loc(name), x, y); return this }
  vec4(name: string, x: number, y: number, z: number, w: number) { this.gl.uniform4f(this.loc(name), x, y, z, w); return this }
  mat3(name: string, m: Float32Array) { this.gl.uniformMatrix3fv(this.loc(name), false, m); return this }
}

/** An RGBA8 texture with a framebuffer on its full-size level. */
export class Target {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  /** With `levels` above 1, the texture has mipmaps (made by the caller) for drawing it reduced. */
  constructor(private gl: WebGL2RenderingContext, readonly width: number, readonly height: number, readonly levels = 1) {
    this.texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, levels > 1 ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
  }
  dispose() {
    this.gl.deleteTexture(this.texture)
    this.gl.deleteFramebuffer(this.framebuffer)
  }
}

export function mipLevels(width: number, height: number) {
  return Math.floor(Math.log2(Math.max(width, height))) + 1
}

/** 3×3 column-major multiply: a · b. */
export function mul3(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(9)
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++) out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]
  return out
}
