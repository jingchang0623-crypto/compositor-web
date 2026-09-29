// Pixels the editor has changed, held in tiles. An edit replaces only the tiles it touched and shares the rest, so
// undo history keeps what a stroke changed rather than a copy of the whole layer (a 4000×3000 layer is 48 MB).

export const TILE = 256

/** Premultiplied RGBA (4 channels) or gray mask values (1), top row first, immutable once made. */
export class RasterSource {
  readonly cols: number
  readonly rows: number

  private constructor(
    readonly width: number,
    readonly height: number,
    readonly channels: 1 | 4,
    /** Row-major; null is a tile of `fill` everywhere. */
    readonly tiles: ReadonlyArray<Uint8Array | null>,
    /** Every byte of a null tile: 0 is transparent for pixels and hiding for masks; 255 reveals for masks. */
    readonly fill: number,
  ) {
    this.cols = Math.ceil(width / TILE)
    this.rows = Math.ceil(height / TILE)
  }

  static blank(width: number, height: number, channels: 1 | 4, fill = 0): RasterSource {
    const cols = Math.ceil(width / TILE), rows = Math.ceil(height / TILE)
    return new RasterSource(width, height, channels, new Array(cols * rows).fill(null), fill)
  }

  static fromPixels(width: number, height: number, channels: 1 | 4, data: Uint8Array, fill = 0): RasterSource {
    return RasterSource.blank(width, height, channels, fill).withRegion(0, 0, width, height, data)
  }

  /** Size of tile (`col`, `row`), smaller at the right and bottom edges. */
  tileSize(col: number, row: number): [number, number] {
    return [Math.min(TILE, this.width - col * TILE), Math.min(TILE, this.height - row * TILE)]
  }

  /**
   * A copy with the tile-aligned region at (`x`, `y`) replaced by `data` (`w`×`h` pixels, top row first). The region
   * must start on tile boundaries and end on one or at the image's edge. Tiles that come out all `fill` are dropped.
   */
  withRegion(x: number, y: number, w: number, h: number, data: Uint8Array): RasterSource {
    if (x % TILE || y % TILE) throw new Error('A region must start on a tile boundary.')
    const tiles = this.tiles.slice()
    const c0 = x / TILE, r0 = y / TILE, c1 = Math.ceil((x + w) / TILE), r1 = Math.ceil((y + h) / TILE)
    const ch = this.channels
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        const [tw, th] = this.tileSize(c, r)
        const tile = new Uint8Array(tw * th * ch)
        let uniform = true
        for (let ty = 0; ty < th; ty++) {
          const from = ((r * TILE + ty - y) * w + (c * TILE - x)) * ch
          const row = data.subarray(from, from + tw * ch)
          tile.set(row, ty * tw * ch)
          if (uniform) for (let i = 0; i < row.length; i++) if (row[i] !== this.fill) { uniform = false; break }
        }
        tiles[r * this.cols + c] = uniform ? null : tile
      }
    return new RasterSource(this.width, this.height, ch, tiles, this.fill)
  }

  /** The pixels of a tile-aligned region, top row first. */
  region(x: number, y: number, w: number, h: number): Uint8Array {
    const ch = this.channels
    const out = new Uint8Array(w * h * ch)
    if (this.fill) out.fill(this.fill)
    const c0 = Math.floor(x / TILE), r0 = Math.floor(y / TILE)
    const c1 = Math.ceil((x + w) / TILE), r1 = Math.ceil((y + h) / TILE)
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        const tile = this.tiles[r * this.cols + c]
        if (!tile) continue
        const [tw, th] = this.tileSize(c, r)
        for (let ty = 0; ty < th; ty++) {
          const yy = r * TILE + ty - y
          if (yy < 0 || yy >= h) continue
          const xs = Math.max(0, x - c * TILE), xe = Math.min(tw, x + w - c * TILE)
          if (xe <= xs) continue
          out.set(tile.subarray((ty * tw + xs) * ch, (ty * tw + xe) * ch), (yy * w + c * TILE + xs - x) * ch)
        }
      }
    return out
  }

  /** Byte offset of pixel (`x`, `y`) inside its tile, with that tile (null: the pixel is `fill`). */
  pixel(x: number, y: number): [Uint8Array | null, number] {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE)
    const [tw] = this.tileSize(c, r)
    return [this.tiles[r * this.cols + c], ((y - r * TILE) * tw + (x - c * TILE)) * this.channels]
  }

  toPixels(): Uint8Array {
    return this.region(0, 0, this.width, this.height)
  }

  /** Bytes this raster holds; tiles shared with other rasters count in each. */
  get bytes(): number {
    let n = 0
    for (const t of this.tiles) if (t) n += t.length
    return n
  }
}

/** A texture being painted: drawn straight from the GPU, and replaced by a RasterSource when the stroke ends. */
export interface GpuSource {
  readonly width: number
  readonly height: number
  readonly texture: WebGLTexture
  /** Whether the texture holds gray mask values in its red channel. */
  readonly mask: boolean
}
