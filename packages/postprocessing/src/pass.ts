import type { DepthTexture, Renderer, RenderTarget } from "three/webgpu";

/** What a pass reads besides its input colour. */
export type PassContext = {
  /** The scene's depth, when the composer's scene pass drew one. */
  depth: DepthTexture | null;
  /** Seconds since the last frame. */
  delta: number;
};

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

  abstract render(
    renderer: Renderer,
    input: RenderTarget,
    output: RenderTarget | null,
    context: PassContext,
  ): void;

  /** The drawing size of the frame, in pixels. */
  setSize(_width: number, _height: number): void {}

  dispose(): void {}
}
