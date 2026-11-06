import type {
  DepthTexture,
  Renderer,
  RenderTarget,
  TextureNode,
  UniformNode,
  Vector2,
} from "three/webgpu";
import { min, mix } from "three/tsl";

import { floatUniform, type Vec2Node, type Vec4Node } from "./nodes";

/**
 * How an effect's colour `y` lands on the colour so far `x`, by `opacity`
 * (pmndrs postprocessing's blend functions, which the effects here port).
 */
export type BlendFunction = "src" | "normal" | "add" | "screen";

export function blend(
  fn: BlendFunction,
  x: Vec4Node,
  y: Vec4Node,
  opacity: UniformNode<"float", number>,
): Vec4Node {
  switch (fn) {
    case "src":
      return y;
    case "normal":
      return mix(x, y, opacity);
    case "add":
      return mix(x, x.add(y), opacity);
    case "screen":
      return mix(x, x.add(y).sub(min(x.mul(y), 1)), opacity);
  }
}

/** What an effect's fragment reads. */
export type EffectInputs = {
  /** The colour so far at this pixel: the input, through the effects before. */
  color: Vec4Node;
  /** This pixel's uv on the frame (v down from the top row). */
  uv: Vec2Node;
  /** The pass's input frame, for an effect that reads neighbours. */
  input: TextureNode;
  /** The scene's depth (0..1 as stored), or null where none was drawn. */
  depth: TextureNode | null;
  /** One pixel in uv, and the frame's size in pixels. */
  texelSize: UniformNode<"vec2", Vector2>;
  resolution: UniformNode<"vec2", Vector2>;
};

/**
 * One effect of an {@link EffectPass}: a TSL colour at each pixel, blended
 * onto the colour so far. Effects that read their input's neighbours
 * (FXAA) read the pass's input, so they come first in a pass.
 */
export abstract class Effect {
  /** Blending onto the colour so far. */
  readonly opacity = floatUniform(1);

  constructor(
    readonly name: string,
    readonly blendFunction: BlendFunction = "normal",
  ) {}

  /** The effect's colour at this pixel. Built once, with the pass's material. */
  abstract fragment(inputs: EffectInputs): Vec4Node;

  /**
   * Before the pass draws, with its input: render whatever the fragment
   * samples (bloom's blur chain).
   */
  update(
    _renderer: Renderer,
    _input: RenderTarget,
    _context: { depth: DepthTexture | null; delta: number },
  ): void {}

  setSize(_width: number, _height: number): void {}

  dispose(): void {}
}
