import type { DepthTexture, Renderer, RenderTarget } from "three/webgpu";

/** What a pass reads besides its input colour. */
export type PassContext = {
  /** The scene's depth, when the composer's scene pass drew one. */
  depth: DepthTexture | null;
  /** Seconds since the last frame. */
  delta: number;
};

/**
 * Runs `draw` and says whether the renderer issued a draw call in it.
 *
 * A renderer can leave a draw out: three skips one whose pipeline is still
 * compiling when the host compiles pipelines off the frame, and one whose
 * shader build the host holds for a later frame. Nothing is written then,
 * and a pass that goes on as if it had drawn hands the next pass a buffer
 * nobody wrote: an empty frame on the screen until the pipeline lands.
 */
export function drew(renderer: Renderer, draw: () => void): boolean {
  const counts = renderer.info.render;
  const before = counts.drawCalls;
  draw();
  return counts.drawCalls > before;
}

/**
 * One step of an {@link EffectComposer}'s frame: reads `input`, draws into
 * `output` (null: the screen). A disabled pass is skipped for free; the
 * composer hands the next pass what the last enabled one drew.
 */
export abstract class Pass {
  /** Skipped while false; switching it costs nothing. */
  enabled = true;

  /** Whether the next pass reads what this one drew (false: it reads this one's input). */
  needsSwap = true;

  constructor(readonly name: string) {}

  /**
   * Draws the pass. Returns false when nothing was drawn into `output`
   * (see {@link drew}); the composer then goes on with `input` as if the
   * pass were disabled this frame. Anything else means it drew.
   */
  abstract render(
    renderer: Renderer,
    input: RenderTarget,
    output: RenderTarget | null,
    context: PassContext,
  ): boolean | void;

  /** The drawing size of the frame, in pixels. */
  setSize(_width: number, _height: number): void {}

  dispose(): void {}
}
