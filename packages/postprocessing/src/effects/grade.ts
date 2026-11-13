import {
  clamp,
  distance,
  max,
  min,
  mix,
  pow,
  select,
  smoothstep,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { type UniformNode, Vector3 } from "three/webgpu";

import { Effect, type EffectInputs } from "../effect";
import {
  floatUniform,
  luminance,
  type Vec3Node,
  type Vec4Node,
} from "../nodes";

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

/** What a {@link LookGradeEffect} starts with. */
export type LookGradeOptions = {
  /** Shifts the displayed colour, as `BrightnessContrastEffect`'s. */
  brightness?: number;
  /**
   * The S-curve's slope at `pivot`, less one: 0 leaves the frame alone, 0.2
   * steepens the mid tones by a fifth. Black and white stay where they are,
   * so no dark value is crushed and no bright one clipped.
   */
  contrast?: number;
  /** The displayed value the S-curve turns about. */
  pivot?: number;
  /**
   * A plain stretch about mid grey after the curve, as
   * `BrightnessContrastEffect`'s contrast: it clips, so a little of it
   * crushes the darks on purpose.
   */
  stretch?: number;
  /**
   * Saturation added to muted colours, fading to none on colours already
   * saturated: a field turns greener without a flower turning neon.
   */
  vibrance?: number;
  /** How far the darks lose their own hue for `shadowTint` (0..1). */
  shadowAmount?: number;
  /** The displayed luminance under which `shadowAmount` fades in. */
  shadowRange?: number;
  /** The hue the darks lean to (a multiplier on their luminance). */
  shadowTint?: [number, number, number];
};

/**
 * The frame's look, graded as displayed (sRGB) and handed on linear: the
 * darks lean toward a tint and lose some of their own hue (moonlight reads
 * as night, not as a dim day), muted colours gain saturation, and an
 * S-curve about `pivot` deepens the mid tones without moving black or
 * white. `brightness` and `stretch` are `BrightnessContrastEffect`'s two
 * values, so one effect serves a frame that wants either grade. A few
 * operations in a pass that already draws: no pass, texture or sample of
 * its own.
 */
export class LookGradeEffect extends Effect {
  readonly brightness: ReturnType<typeof floatUniform>;
  readonly contrast: ReturnType<typeof floatUniform>;
  readonly pivot: ReturnType<typeof floatUniform>;
  readonly stretch: ReturnType<typeof floatUniform>;
  readonly vibrance: ReturnType<typeof floatUniform>;
  readonly shadowAmount: ReturnType<typeof floatUniform>;
  readonly shadowRange: ReturnType<typeof floatUniform>;
  readonly shadowTint: UniformNode<"vec3", Vector3>;

  constructor(options: LookGradeOptions = {}) {
    super("look-grade", "src");
    this.brightness = floatUniform(options.brightness ?? 0);
    this.contrast = floatUniform(options.contrast ?? 0);
    this.pivot = floatUniform(options.pivot ?? 0.45);
    this.stretch = floatUniform(options.stretch ?? 0);
    this.vibrance = floatUniform(options.vibrance ?? 0);
    this.shadowAmount = floatUniform(options.shadowAmount ?? 0);
    this.shadowRange = floatUniform(options.shadowRange ?? 0.35);
    this.shadowTint = uniform(
      new Vector3(...(options.shadowTint ?? [1, 1, 1])),
    ) as unknown as UniformNode<"vec3", Vector3>;
  }

  fragment({ color }: EffectInputs): Vec4Node {
    const displayed = (
      sRGBTransferOETF(max(color.rgb, vec3(0))) as unknown as Vec3Node
    )
      .add(vec3(this.brightness))
      .toVar("gradeDisplayed");

    // The darks: toward their own luminance in the shadow tint.
    const darkLuma = luminance(displayed);
    const shade = smoothstep(0, this.shadowRange, darkLuma)
      .oneMinus()
      .mul(this.shadowAmount);
    displayed.assign(mix(displayed, this.shadowTint.mul(darkLuma), shade));

    // Vibrance: saturation about the luminance, by how muted the colour is.
    const peak = max(max(displayed.x, displayed.y), displayed.z);
    const trough = min(min(displayed.x, displayed.y), displayed.z);
    const luma = luminance(displayed);
    const muted = peak.sub(trough).oneMinus();
    displayed.assign(
      vec3(luma).add(
        displayed.sub(vec3(luma)).mul(this.vibrance.mul(muted).add(1)),
      ),
    );

    // The S-curve: a power on each side of the pivot, equal in slope there.
    const x = clamp(displayed, 0, 1);
    const power = vec3(this.contrast.add(1));
    const pivot = vec3(this.pivot);
    const below = pivot.mul(pow(x.div(pivot), power));
    const above = pivot
      .oneMinus()
      .mul(pow(x.oneMinus().div(pivot.oneMinus()), power))
      .oneMinus();
    const curved = mix(below, above, step(pivot, x)).sub(0.5);
    const stretched = max(
      select(
        this.stretch.greaterThan(0),
        curved.div(vec3(this.stretch.oneMinus())),
        curved.mul(vec3(this.stretch.add(1))),
      ).add(0.5),
      vec3(0),
    );
    return vec4(sRGBTransferEOTF(stretched) as unknown as Vec3Node, color.a);
  }
}
