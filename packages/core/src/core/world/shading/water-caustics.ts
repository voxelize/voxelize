import { abs, clamp, cos, Fn, length, mod, pow, sin, vec2 } from "three/tsl";

import type { FloatNode, Vec2Node } from "./types";

/**
 * A tileable caustic web (after Dave Hoskins' water caustic): bright where
 * an iterated warp's focus lines meet, repeating every three blocks. Shared
 * by the seabed caustics, the surface underside and the client's light
 * shafts, so all show one pattern on one clock. Returns 0..1.
 */
export const waterCausticWeb = /*@__PURE__*/ Fn(
  ([position, seconds]: [Vec2Node, FloatNode]) => {
    const p = mod(position.mul((Math.PI * 2) / 3), Math.PI * 2).sub(250);
    let i: Vec2Node = p;
    let sum: FloatNode = seconds.mul(0).add(1);
    for (let n = 0; n < 4; n++) {
      const t = seconds.mul(0.45 * (1 - 3.5 / (n + 1)));
      i = p.add(
        vec2(
          cos(t.sub(i.x)).add(sin(t.add(i.y))),
          sin(t.sub(i.y)).add(cos(t.add(i.x))),
        ),
      );
      sum = sum.add(
        length(
          vec2(
            p.x.div(sin(i.x.add(t)).div(0.005)),
            p.y.div(cos(i.y.add(t)).div(0.005)),
          ),
        ).reciprocal(),
      );
    }
    const web = pow(sum.div(4), 1.4).negate().add(1.17);
    return clamp(pow(abs(web), 8), 0, 1);
  },
  { position: "vec2", seconds: "float", return: "float" },
);
