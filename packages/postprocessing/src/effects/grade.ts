import {
  distance,
  max,
  select,
  smoothstep,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { Effect, type EffectInputs } from "../effect";
import { floatUniform, type Vec3Node, type Vec4Node } from "../nodes";

/**
 * Darkens toward the frame's corners (pmndrs postprocessing's
 * `VignetteEffect`, default technique): the colour times
 * `smoothstep(0.8, offset * 0.799, d * (darkness + offset))`, `d` the
 * distance from the centre in uv.
 */
export class VignetteEffect extends Effect {
  readonly offset: ReturnType<typeof floatUniform>;
  readonly darkness: ReturnType<typeof floatUniform>;

  constructor(options: { offset?: number; darkness?: number } = {}) {
    super("vignette", "normal");
    this.offset = floatUniform(options.offset ?? 0.5);
    this.darkness = floatUniform(options.darkness ?? 0.5);
  }

  fragment({ color, uv }: EffectInputs): Vec4Node {
    const d = distance(uv, vec2(0.5));
    const shade = smoothstep(
      0.8,
      this.offset.mul(0.799),
      d.mul(this.darkness.add(this.offset)),
    );
    return vec4(color.rgb.mul(shade), color.a);
  }
}

/**
 * Brightness and contrast about mid grey (pmndrs postprocessing's
 * `BrightnessContrastEffect`): `brightness` shifts the colour, `contrast`
 * above 0 stretches it, below 0 flattens it. Graded as displayed (sRGB, as
 * pmndrs declares its input), then back to linear for what follows: about
 * linear mid grey, a little contrast crushes every dark value to black.
 */
export class BrightnessContrastEffect extends Effect {
  readonly brightness: ReturnType<typeof floatUniform>;
  readonly contrast: ReturnType<typeof floatUniform>;

  constructor(options: { brightness?: number; contrast?: number } = {}) {
    super("brightness-contrast", "src");
    this.brightness = floatUniform(options.brightness ?? 0);
    this.contrast = floatUniform(options.contrast ?? 0);
  }

  fragment({ color }: EffectInputs): Vec4Node {
    const displayed = sRGBTransferOETF(
      max(color.rgb, vec3(0)),
    ) as unknown as Vec3Node;
    const shifted = displayed.add(vec3(this.brightness.sub(0.5)));
    const stretched = select(
      this.contrast.greaterThan(0),
      shifted.div(vec3(this.contrast.oneMinus())),
      shifted.mul(vec3(this.contrast.add(1))),
    );
    const graded = max(stretched.add(vec3(0.5)), vec3(0));
    return vec4(sRGBTransferEOTF(graded) as unknown as Vec3Node, color.a);
  }
}
