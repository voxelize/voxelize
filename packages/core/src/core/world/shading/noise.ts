import {
  abs,
  dot,
  Fn,
  floor,
  max,
  min,
  mod,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import type { FloatNode, Vec3Node, Vec4Node } from "./types";

const permute = (x: Vec4Node): Vec4Node => mod(x.mul(34).add(1).mul(x), 289);

const taylorInvSqrt = (r: Vec4Node): Vec4Node =>
  r.mul(-0.85373472095314).add(1.79284291400159);

/**
 * 3D simplex noise (Ashima / Ian McEwan), -1..1. The chunk shaders' swell,
 * sway and water streaks all read it, and `simplexNoise3` in fluid-waves.ts
 * is its CPU twin (floats ride the swell the player sees), so the two must
 * agree to the bit pattern of the math: change neither alone.
 */
export const simplexNoise3Node = /*@__PURE__*/ Fn(
  ([v]: [Vec3Node]) => {
    const C = vec2(1 / 6, 1 / 3);

    const i = floor(v.add(dot(v, C.yyy))).toVar();
    const x0 = v.sub(i).add(dot(i, C.xxx));

    const g = step(x0.yzx, x0.xyz);
    const l = g.oneMinus();
    const i1 = min(g.xyz, l.zxy);
    const i2 = max(g.xyz, l.zxy);

    const x1 = x0.sub(i1).add(C.xxx);
    const x2 = x0.sub(i2).add(C.xxx.mul(2));
    const x3 = x0.sub(1).add(C.xxx.mul(3));

    i.assign(mod(i, 289));
    const p = permute(
      permute(
        permute(vec4(0, i1.z, i2.z, 1).add(i.z))
          .add(i.y)
          .add(vec4(0, i1.y, i2.y, 1)),
      )
        .add(i.x)
        .add(vec4(0, i1.x, i2.x, 1)),
    );

    // n_ = 1/7; ns = n_ * D.wyz - D.xzx with D = (0, 0.5, 1, 2)
    const ns = vec3(2 / 7, 0.5 / 7 - 1, 1 / 7);

    const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49));

    const xs = floor(j.mul(ns.z));
    const ys = floor(j.sub(xs.mul(7)));

    const x = xs.mul(ns.x).add(ns.yyyy);
    const y = ys.mul(ns.x).add(ns.yyyy);
    const h = abs(x).negate().sub(abs(y)).add(1);

    const b0 = vec4(x.xy, y.xy);
    const b1 = vec4(x.zw, y.zw);

    const s0 = floor(b0).mul(2).add(1);
    const s1 = floor(b1).mul(2).add(1);
    const sh = step(h, vec4(0)).negate();

    const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy));
    const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww));

    const p0 = vec3(a0.xy, h.x);
    const p1 = vec3(a0.zw, h.y);
    const p2 = vec3(a1.xy, h.z);
    const p3 = vec3(a1.zw, h.w);

    const norm = taylorInvSqrt(
      vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)),
    );

    const m = max(
      vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))
        .negate()
        .add(0.6),
      0,
    );
    const m2 = m.mul(m);

    return dot(
      m2.mul(m2),
      vec4(
        dot(p0.mul(norm.x), x0),
        dot(p1.mul(norm.y), x1),
        dot(p2.mul(norm.z), x2),
        dot(p3.mul(norm.w), x3),
      ),
    ).mul(42) as FloatNode;
  },
  { v: "vec3", return: "float" },
);
