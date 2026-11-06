import {
  clamp,
  dot,
  exp2,
  Fn,
  max,
  min,
  mix,
  select,
  smoothstep,
  step,
  vec3,
} from "three/tsl";

import {
  BLOCK_LIGHT_LOG2_RATIO,
  BLOCK_LIGHT_TAIL,
  BLOCK_LIGHT_TRANSFER,
  BLOCK_LIGHT_HUE_RAMP_LEVEL,
} from "../block-light-transfer";

import type { FloatNode, Vec3Node } from "./types";

const LUMA = vec3(0.2126, 0.7152, 0.0722);

const max3 = (v: Vec3Node): FloatNode => max(max(v.x, v.y), v.z);

/**
 * Flood level (0..1 per channel) to light: brightness from the brightest
 * channel down the geometric per-level curve, hue from the channels' level
 * gaps (`BLOCK_LIGHT_TRANSFER.hueLevels`). A channel's share fades in over
 * its first level, and a channel that has run out borrows the hue of the
 * analytic lights around the fragment (`fill`, zero when there are none),
 * capped by what its gap still allows. The CPU twin is
 * `blockLightCurveRGB` (block-light-transfer.ts); change neither alone.
 */
export const blockLightCurveFilledNode = /*@__PURE__*/ Fn(
  ([level, fill]: [Vec3Node, Vec3Node]) => {
    const x = clamp(level, 0, 1);
    const geometric = max(
      exp2(x.oneMinus().mul(BLOCK_LIGHT_LOG2_RATIO)).sub(BLOCK_LIGHT_TAIL),
      0,
    ).mul(1 / (1 - BLOCK_LIGHT_TAIL));

    const peak = max3(x);
    const bright = max3(geometric);
    const gapShare = clamp(
      peak.sub(x).mul(15 / BLOCK_LIGHT_TRANSFER.hueLevels).oneMinus(),
      0,
      1,
    );
    const lit = min(
      x.div(max(min(peak, BLOCK_LIGHT_HUE_RAMP_LEVEL), 1e-6)),
      1,
    );
    const fillPeak = max3(fill);
    const onPeak = step(vec3(peak), x).mul(fill);
    const fillScale = select(
      fillPeak.greaterThan(0),
      max(max3(onPeak), 0).div(fillPeak.mul(fillPeak)),
      0,
    );
    const fillShare = min(max(fill, 0).mul(fillScale), gapShare);
    return mix(fillShare, gapShare, lit).mul(bright);
  },
  { level: "vec3", fill: "vec3", return: "vec3" },
);

export const blockLightCurveNode = (level: Vec3Node): Vec3Node =>
  blockLightCurveFilledNode(level, vec3(0));

export const blockLightCurve1Node = (level: FloatNode): FloatNode =>
  blockLightCurveNode(vec3(level)).x;

/** The ACES fit the chunk light multiplier is tone-mapped through. */
export const acesFitNode = <T extends FloatNode | Vec3Node>(x: T): T =>
  x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)) as T;

/**
 * Windowed inverse square: a hot core of `kernelCoreRatio x range` that
 * fades evenly to zero at `range` (`localLightFalloff` is its CPU twin).
 * `d2` is the squared distance the core is measured with, which a ceiling
 * light flattens (`blockLightMountFade`).
 */
export const blockLightKernelFalloff = /*@__PURE__*/ Fn(
  ([dist, d2, range]: [FloatNode, FloatNode, FloatNode]) => {
    const n = dist.div(range);
    const n2 = n.mul(n);
    const window = n2.mul(n2).oneMinus();
    const core = range.mul(BLOCK_LIGHT_TRANSFER.tightKernelCoreRatio);
    return window
      .mul(window)
      .mul(BLOCK_LIGHT_TRANSFER.tightKernelGain)
      .div(d2.div(core.mul(core)).add(1));
  },
  { dist: "float", d2: "float", range: "float", return: "float" },
);

/**
 * 0 on a ceiling a light hangs just under (its falloff flattens there), 1
 * elsewhere (`BLOCK_LIGHT_TRANSFER.mountNear`/`mountFar`).
 */
export const blockLightMountFade = /*@__PURE__*/ Fn(
  ([toLight, normal]: [Vec3Node, Vec3Node]) => {
    const plane = dot(toLight, normal);
    const near = smoothstep(
      BLOCK_LIGHT_TRANSFER.mountNear,
      BLOCK_LIGHT_TRANSFER.mountFar,
      plane,
    )
      .oneMinus()
      .mul(smoothstep(0.5, 0.9, normal.y.negate()));
    return near.oneMinus();
  },
  { toLight: "vec3", normal: "vec3", return: "float" },
);

/**
 * Lamplight white balance: block light moves toward its own luminance by
 * `adaptation x torchDominance` before the warm tint, so a flame reads warm
 * rather than saturated (`blockLightAdaptNode` on the CPU).
 */
export const blockLightAdaptNode = (light: Vec3Node, torchDominance: FloatNode) =>
  mix(
    light,
    vec3(dot(light, LUMA)),
    clamp(torchDominance, 0, 1).mul(BLOCK_LIGHT_TRANSFER.adaptation),
  );

export const luminance709 = (color: Vec3Node): FloatNode => dot(color, LUMA);

export const BLOCK_LIGHT_GAIN = BLOCK_LIGHT_TRANSFER.gain;

/** The analytic kernel's core, as a fraction of a light's range. */
export const BLOCK_LIGHT_TRANSFER_KERNEL_CORE =
  BLOCK_LIGHT_TRANSFER.tightKernelCoreRatio;
