/**
 * The arithmetic of the engine's pass, for the figures: the depth weight and
 * the accumulation mirror `orderIndependentFragment` and the composite in
 * `packages/core/src/core/world/order-independent-transparency.ts`.
 */

export type Rgb = [number, number, number];

export type Weights = {
  scale: number;
  nearDistance: number;
  farDistance: number;
  min: number;
  max: number;
};

export const DEFAULT_WEIGHTS: Weights = {
  scale: 10,
  nearDistance: 10,
  farDistance: 200,
  min: 0.01,
  max: 1000,
};

export type Layer = {
  id: string;
  name: string;
  /** sRGB, 0-1. */
  color: Rgb;
  alpha: number;
  /** Distance from the camera, in blocks. */
  distance: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function depthWeight(distance: number, weights = DEFAULT_WEIGHTS) {
  return clamp(
    weights.scale /
      (1e-5 +
        (distance / weights.nearDistance) ** 3 +
        (distance / weights.farDistance) ** 6),
    weights.min,
    weights.max,
  );
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

export const linear = (rgb: Rgb): Rgb => rgb.map(toLinear) as Rgb;
export const srgb = (rgb: Rgb): Rgb =>
  rgb.map((c) => toSrgb(clamp(c, 0, 1))) as Rgb;

export const css = (rgb: Rgb) =>
  `rgb(${rgb.map((c) => Math.round(clamp(c, 0, 1) * 255)).join(", ")})`;

/** Normal blending, in the order given: what a sorted pipeline draws. */
export function blendInOrder(layers: Layer[], background: Rgb): Rgb {
  let out = linear(background);
  for (const layer of layers) {
    const c = linear(layer.color);
    out = out.map((d, i) => c[i] * layer.alpha + d * (1 - layer.alpha)) as Rgb;
  }
  return srgb(out);
}

/** Back to front: the answer a perfect sort gives. */
export function blendBackToFront(layers: Layer[], background: Rgb): Rgb {
  return blendInOrder(
    [...layers].sort((a, b) => b.distance - a.distance),
    background,
  );
}

export type Accumulation = {
  /** Σ premultiplied colour × weight, linear. */
  accumulated: Rgb;
  /** Π (1 − α): how much of the scene still shows. */
  revealage: number;
  /** Σ α × weight. */
  weight: number;
  result: Rgb;
};

/**
 * Weighted blended: the two targets' sums, then the composite over the
 * scene. Order of `layers` does not matter: every operation is a sum or a
 * product.
 */
export function accumulate(
  layers: Layer[],
  background: Rgb,
  weights = DEFAULT_WEIGHTS,
): Accumulation {
  const accumulated: Rgb = [0, 0, 0];
  let revealage = 1;
  let weight = 0;
  for (const layer of layers) {
    const c = linear(layer.color);
    const w = layer.alpha * depthWeight(layer.distance, weights);
    for (let i = 0; i < 3; i++) accumulated[i] += c[i] * layer.alpha * w;
    revealage *= 1 - layer.alpha;
    weight += layer.alpha * w;
  }
  const coverage = 1 - revealage;
  const bg = linear(background);
  const result = accumulated.map(
    (a, i) => (a / Math.max(weight, 1e-5)) * coverage + bg[i] * revealage,
  ) as Rgb;
  return { accumulated, revealage, weight, result: srgb(result) };
}

/** How far apart two colours are, 0 (same) to 1. */
export function difference(a: Rgb, b: Rgb) {
  return Math.sqrt(a.reduce((sum, c, i) => sum + (c - b[i]) ** 2, 0) / 3);
}
