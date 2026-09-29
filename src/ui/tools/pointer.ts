// What a canvas tool gets from the pointer, and what it gives back.

export interface ToolPointer {
  /** In document pixels. */
  x: number
  y: number
  /** In CSS pixels from the canvas's top-left, for handles that have a fixed on-screen size. */
  sx: number
  sy: number
  shift: boolean
  alt: boolean
  meta: boolean
  ctrl: boolean
  pressure: number
}

export interface ToolController {
  /** True when the tool takes this press (the canvas then captures the pointer for it). */
  down(p: ToolPointer): boolean
  move(p: ToolPointer): void
  up(p: ToolPointer): void
  /** The cursor for a pointer that isn't pressed. */
  hover?(p: ToolPointer): string
  /** Pointer left the canvas. */
  leave?(): void
  /** An arrow key, as a step in document pixels; true when the tool used it. */
  key?(e: KeyboardEvent, dx: number, dy: number): boolean
}
