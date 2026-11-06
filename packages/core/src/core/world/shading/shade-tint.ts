import { clamp, dot, max, min, mix, vec3 } from "three/tsl";

import type { FloatNode, Vec3Node } from "./types";

/**
 * How far the sky's own hue colours the light in shade. A face out of the
 * sun is lit by the sky alone, so it reads cool against the warm sunlit
 * faces around it; tinting the whole ambient instead greyed the sunlit
 * ones too. `maxChannel` caps the hue (the zenith's blue over its own
 * luminance) so a saturated sky never turns shade cyan.
 */
export const SHADE_SKY_TINT = Object.freeze({ amount: 0.16, maxChannel: 2.4 });

/**
 * The multiplier on a face's sky light: white in full sun, toward the
 * zenith's hue as `shadow` (1 lit, 0 shaded) falls, by daylight and by how
 * much of the sky the face sees. The chunk and far-terrain shading both
 * take it, so the loaded edge and the far layer shade alike.
 */
export function shadeSkyTint(
  skyTop: Vec3Node,
  daylight: FloatNode,
  shadow: FloatNode,
  skyExposure: FloatNode,
): Vec3Node {
  const luma = max(dot(skyTop, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  const hue = min(skyTop.div(luma), vec3(SHADE_SKY_TINT.maxChannel));
  const amount = clamp(daylight, 0, 1)
    .mul(clamp(skyExposure, 0, 1))
    .mul(shadow.oneMinus())
    .mul(SHADE_SKY_TINT.amount);
  return mix(vec3(1), hue, amount) as Vec3Node;
}
