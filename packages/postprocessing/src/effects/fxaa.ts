import { abs, clamp, Fn, If, max, min, select, vec2 } from "three/tsl";

import { Effect, type EffectInputs } from "../effect";
import { type FloatNode, luminance, type Vec2Node, type Vec4Node } from "../nodes";

export type FxaaOptions = {
  /** Contrast below which a pixel is left alone, absolute. */
  edgeThresholdMin: number;
  /** Contrast below which a pixel is left alone, relative to its brightest neighbour. */
  edgeThresholdMax: number;
  /** How much sub-pixel aliasing is smoothed, 0..1. */
  subpixelQuality: number;
  /** Steps of the edge search either way. */
  samples: number;
};

const DEFAULT_FXAA: FxaaOptions = {
  edgeThresholdMin: 0.0312,
  edgeThresholdMax: 0.125,
  subpixelQuality: 0.75,
  samples: 12,
};

/** The edge search's step growth (pmndrs postprocessing's `QUALITY(q)`). */
const quality = (q: number) =>
  q < 5 ? 1 : q > 5 ? (q < 10 ? 2 : q < 11 ? 4 : 8) : 1.5;

/**
 * FXAA 3.11 (pmndrs postprocessing's `FXAAEffect`, ported): finds each
 * pixel's edge from its neighbours' luminance, searches along it for its
 * ends, and resamples the input across it. Reads the pass's input, so it
 * comes first in its pass.
 */
export class FxaaEffect extends Effect {
  private readonly o: FxaaOptions;

  constructor(options: Partial<FxaaOptions> = {}) {
    super("fxaa", "src");
    this.o = { ...DEFAULT_FXAA, ...options };
  }

  fragment({ color, uv, input, texelSize }: EffectInputs): Vec4Node {
    const o = this.o;
    const at = (p: Vec2Node) => input.sample(p) as unknown as Vec4Node;
    const lumaAt = (dx: number, dy: number) =>
      luminance(at(uv.add(vec2(dx, dy).mul(texelSize))).rgb);
    return Fn(() => {
      const result = color.toVar("fxaaResult");
      const lumaCenter = luminance(color.rgb).toVar("fxaaCenter");
      const lumaDown = lumaAt(0, -1).toVar();
      const lumaUp = lumaAt(0, 1).toVar();
      const lumaLeft = lumaAt(-1, 0).toVar();
      const lumaRight = lumaAt(1, 0).toVar();
      const lumaMin = min(lumaCenter, min(min(lumaDown, lumaUp), min(lumaLeft, lumaRight)));
      const lumaMax = max(lumaCenter, max(max(lumaDown, lumaUp), max(lumaLeft, lumaRight)));
      const lumaRange = lumaMax.sub(lumaMin).toVar();
      If(lumaRange.greaterThanEqual(max(o.edgeThresholdMin, lumaMax.mul(o.edgeThresholdMax))), () => {
        const lumaDownLeft = lumaAt(-1, -1);
        const lumaUpRight = lumaAt(1, 1);
        const lumaUpLeft = lumaAt(-1, 1);
        const lumaDownRight = lumaAt(1, -1);
        const lumaDownUp = lumaDown.add(lumaUp).toVar();
        const lumaLeftRight = lumaLeft.add(lumaRight).toVar();
        const lumaLeftCorners = lumaDownLeft.add(lumaUpLeft).toVar();
        const lumaDownCorners = lumaDownLeft.add(lumaDownRight).toVar();
        const lumaRightCorners = lumaDownRight.add(lumaUpRight).toVar();
        const lumaUpCorners = lumaUpRight.add(lumaUpLeft).toVar();
        const edgeHorizontal = abs(lumaLeft.mul(-2).add(lumaLeftCorners))
          .add(abs(lumaCenter.mul(-2).add(lumaDownUp)).mul(2))
          .add(abs(lumaRight.mul(-2).add(lumaRightCorners)));
        const edgeVertical = abs(lumaUp.mul(-2).add(lumaUpCorners))
          .add(abs(lumaCenter.mul(-2).add(lumaLeftRight)).mul(2))
          .add(abs(lumaDown.mul(-2).add(lumaDownCorners)));
        const isHorizontal = edgeHorizontal.greaterThanEqual(edgeVertical).toVar();
        const stepLength = select(isHorizontal, texelSize.y, texelSize.x).toVar();
        const luma1 = select(isHorizontal, lumaDown, lumaLeft);
        const luma2 = select(isHorizontal, lumaUp, lumaRight);
        const gradient1 = abs(luma1.sub(lumaCenter));
        const gradient2 = abs(luma2.sub(lumaCenter));
        const is1Steepest = gradient1.greaterThanEqual(gradient2);
        const gradientScaled = max(gradient1, gradient2).mul(0.25).toVar();
        const lumaLocalAverage = select(
          is1Steepest,
          luma1.add(lumaCenter).mul(0.5),
          luma2.add(lumaCenter).mul(0.5),
        ).toVar();
        stepLength.assign(select(is1Steepest, stepLength.negate(), stepLength));
        const currentUv = vec2(uv).toVar();
        If(isHorizontal, () => {
          currentUv.y.addAssign(stepLength.mul(0.5));
        }).Else(() => {
          currentUv.x.addAssign(stepLength.mul(0.5));
        });
        const offset = select(
          isHorizontal,
          vec2(texelSize.x, 0),
          vec2(0, texelSize.y),
        ).toVar();
        const uv1 = currentUv.sub(offset.mul(quality(0))).toVar();
        const uv2 = currentUv.add(offset.mul(quality(0))).toVar();
        const lumaEnd1 = luminance(at(uv1).rgb).sub(lumaLocalAverage).toVar();
        const lumaEnd2 = luminance(at(uv2).rgb).sub(lumaLocalAverage).toVar();
        const reached1 = abs(lumaEnd1).greaterThanEqual(gradientScaled).toVar();
        const reached2 = abs(lumaEnd2).greaterThanEqual(gradientScaled).toVar();
        const reachedBoth = reached1.and(reached2).toVar();
        If(reached1.not(), () => {
          uv1.subAssign(offset.mul(quality(1)));
        });
        If(reached2.not(), () => {
          uv2.addAssign(offset.mul(quality(1)));
        });
        for (let i = 2; i < o.samples; i++) {
          If(reachedBoth.not(), () => {
            If(reached1.not(), () => {
              lumaEnd1.assign(luminance(at(uv1).rgb).sub(lumaLocalAverage));
            });
            If(reached2.not(), () => {
              lumaEnd2.assign(luminance(at(uv2).rgb).sub(lumaLocalAverage));
            });
            reached1.assign(abs(lumaEnd1).greaterThanEqual(gradientScaled));
            reached2.assign(abs(lumaEnd2).greaterThanEqual(gradientScaled));
            reachedBoth.assign(reached1.and(reached2));
            If(reached1.not(), () => {
              uv1.subAssign(offset.mul(quality(i)));
            });
            If(reached2.not(), () => {
              uv2.addAssign(offset.mul(quality(i)));
            });
          });
        }
        const distance1 = select(isHorizontal, uv.x.sub(uv1.x), uv.y.sub(uv1.y));
        const distance2 = select(isHorizontal, uv2.x.sub(uv.x), uv2.y.sub(uv.y));
        const isDirection1 = distance1.lessThan(distance2);
        const distanceFinal = min(distance1, distance2);
        const edgeThickness = distance1.add(distance2);
        const isLumaCenterSmaller = lumaCenter.lessThan(lumaLocalAverage);
        const correctVariation1 = lumaEnd1.lessThan(0).xor(isLumaCenterSmaller);
        const correctVariation2 = lumaEnd2.lessThan(0).xor(isLumaCenterSmaller);
        const correctVariation = select(isDirection1, correctVariation1, correctVariation2);
        const pixelOffset = distanceFinal.negate().div(edgeThickness).add(0.5);
        const finalOffset = select(correctVariation, pixelOffset, 0) as FloatNode;
        const lumaAverage = lumaDownUp
          .add(lumaLeftRight)
          .mul(2)
          .add(lumaLeftCorners)
          .add(lumaRightCorners)
          .mul(1 / 12);
        const subPixelOffset1 = clamp(abs(lumaAverage.sub(lumaCenter)).div(lumaRange), 0, 1);
        const subPixelOffset2 = subPixelOffset1
          .mul(-2)
          .add(3)
          .mul(subPixelOffset1)
          .mul(subPixelOffset1);
        const subPixelOffsetFinal = subPixelOffset2.mul(subPixelOffset2).mul(o.subpixelQuality);
        const offsetFinal = max(finalOffset, subPixelOffsetFinal);
        const finalUv = vec2(uv).toVar();
        If(isHorizontal, () => {
          finalUv.y.addAssign(offsetFinal.mul(stepLength));
        }).Else(() => {
          finalUv.x.addAssign(offsetFinal.mul(stepLength));
        });
        result.assign(at(finalUv));
      });
      return result;
    })() as unknown as Vec4Node;
  }
}
