import { max, mix, pow, step, vec3 } from "three/tsl";

import type { Vec3Node } from "./nodes";

/**
 * Linear sRGB to the sRGB transfer, for a pass that draws to the screen
 * itself (the renderer's own output conversion is a whole extra pass).
 */
export function linearToSrgb(color: Vec3Node): Vec3Node {
  const c = max(color, vec3(0));
  return mix(
    c.mul(12.92),
    pow(c, vec3(1 / 2.4)).mul(1.055).sub(0.055),
    step(vec3(0.0031308), c),
  );
}
