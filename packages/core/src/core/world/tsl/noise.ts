import {
  abs,
  dot,
  Fn,
  float,
  floor,
  max,
  min,
  mod,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

const permute = /*@__PURE__*/ Fn(([x_immutable]: [Node]) => {
  const x = vec4(x_immutable).toVar();
  return mod(x.mul(34.0).add(1.0).mul(x), 289.0);
});

const taylorInvSqrt = /*@__PURE__*/ Fn(([r_immutable]: [Node]) => {
  const r = vec4(r_immutable).toVar();
  return float(1.79284291400159).sub(float(0.85373472095314).mul(r));
});

export const snoise: (v: Node) => Node = /*@__PURE__*/ Fn(
  ([v_immutable]: [Node]) => {
    const v = vec3(v_immutable).toVar();

    const C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const D = vec4(0.0, 0.5, 1.0, 2.0);

    const i = floor(v.add(dot(v, C.yyy))).toVar();
    const x0 = v.sub(i).add(dot(i, C.xxx)).toVar();

    const g = step(x0.yzx, x0.xyz);
    const l = float(1.0).sub(g);
    const i1 = min(g.xyz, l.zxy);
    const i2 = max(g.xyz, l.zxy);

    const x1 = x0.sub(i1).add(C.xxx);
    const x2 = x0.sub(i2).add(vec3(C.x).mul(2.0));
    const x3 = x0.sub(1.0).add(vec3(C.x).mul(3.0));

    i.assign(mod(i, 289.0));

    const p = permute(
      permute(
        permute(i.z.add(vec4(0.0, i1.z, i2.z, 1.0)))
          .add(i.y)
          .add(vec4(0.0, i1.y, i2.y, 1.0)),
      )
        .add(i.x)
        .add(vec4(0.0, i1.x, i2.x, 1.0)),
    );

    const n_ = float(1.0 / 7.0);
    const ns = vec3(n_).mul(D.wyz).sub(D.xzx);

    const j = p.sub(float(49.0).mul(floor(p.mul(ns.z).mul(ns.z))));

    const x_ = floor(j.mul(ns.z));
    const y_ = floor(j.sub(float(7.0).mul(x_)));

    const x = x_.mul(ns.x).add(ns.yyyy);
    const y = y_.mul(ns.x).add(ns.yyyy);
    const h = float(1.0).sub(abs(x)).sub(abs(y));

    const b0 = vec4(x.xy, y.xy);
    const b1 = vec4(x.zw, y.zw);

    const s0 = floor(b0).mul(2.0).add(1.0);
    const s1 = floor(b1).mul(2.0).add(1.0);
    const sh = step(h, vec4(0.0)).negate();

    const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy));
    const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww));

    const p0 = vec3(a0.xy, h.x).toVar();
    const p1 = vec3(a0.zw, h.y).toVar();
    const p2 = vec3(a1.xy, h.z).toVar();
    const p3 = vec3(a1.zw, h.w).toVar();

    const norm = taylorInvSqrt(
      vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)),
    );
    p0.mulAssign(norm.x);
    p1.mulAssign(norm.y);
    p2.mulAssign(norm.z);
    p3.mulAssign(norm.w);

    const m = max(
      float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))),
      0.0,
    ).toVar();
    m.mulAssign(m);

    return float(42.0).mul(
      dot(m.mul(m), vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))),
    );
  },
);
