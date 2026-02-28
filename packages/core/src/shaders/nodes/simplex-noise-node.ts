import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  floor,
  mod,
  abs,
  max,
  min,
  step,
  dot,
} from "three/tsl";

const permute = /* @__PURE__ */ Fn(([x]: [ReturnType<typeof vec4>]) => {
  return mod(x.mul(34.0).add(1.0).mul(x), 289.0);
});

const taylorInvSqrt = /* @__PURE__ */ Fn(([r]: [ReturnType<typeof vec4>]) => {
  return float(1.79284291400159).sub(r.mul(0.85373472095314));
});

export const simplexNoise3d = /* @__PURE__ */ Fn(
  ([v]: [ReturnType<typeof vec3>]) => {
    const C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const D = vec4(0.0, 0.5, 1.0, 2.0);

    const i = floor(v.add(dot(v, C.yyy)));
    const x0 = v.sub(i).add(dot(i, C.xxx));

    const g = step(x0.yzx, x0.xyz);
    const l = float(1.0).sub(g);
    const i1 = min(g.xyz, l.zxy);
    const i2 = max(g.xyz, l.zxy);

    const x1 = x0.sub(i1).add(C.xxx);
    const x2 = x0.sub(i2).add(C.xxx.mul(2.0));
    const x3 = x0.sub(1.0).add(C.xxx.mul(3.0));

    const iMod = mod(i, 289.0);

    const pInner = permute(iMod.z.add(vec4(0.0, i1.z, i2.z, 1.0)));
    const pMiddle = permute(pInner.add(iMod.y).add(vec4(0.0, i1.y, i2.y, 1.0)));
    const p = permute(pMiddle.add(iMod.x).add(vec4(0.0, i1.x, i2.x, 1.0)));

    const n_ = float(1.0 / 7.0);
    const ns = n_.mul(D.wyz).sub(D.xzx);

    const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49.0));

    const xFloor = floor(j.mul(ns.z));
    const yFloor = floor(j.sub(xFloor.mul(7.0)));

    const xCoord = xFloor.mul(ns.x).add(ns.y);
    const yCoord = yFloor.mul(ns.x).add(ns.y);
    const h = float(1.0).sub(abs(xCoord)).sub(abs(yCoord));

    const b0 = vec4(xCoord.x, xCoord.y, yCoord.x, yCoord.y);
    const b1 = vec4(xCoord.z, xCoord.w, yCoord.z, yCoord.w);

    const s0 = floor(b0).mul(2.0).add(1.0);
    const s1 = floor(b1).mul(2.0).add(1.0);
    const sh = step(h, vec4(0.0)).negate();

    const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy));
    const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww));

    const p0 = vec3(a0.x, a0.y, h.x);
    const p1 = vec3(a0.z, a0.w, h.y);
    const p2 = vec3(a1.x, a1.y, h.z);
    const p3 = vec3(a1.z, a1.w, h.w);

    const normVec = taylorInvSqrt(
      vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)),
    );
    const p0n = p0.mul(normVec.x);
    const p1n = p1.mul(normVec.y);
    const p2n = p2.mul(normVec.z);
    const p3n = p3.mul(normVec.w);

    const m = max(
      float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))),
      0.0,
    );
    const m2 = m.mul(m);
    const m4 = m2.mul(m2);

    return float(42.0).mul(
      dot(m4, vec4(dot(p0n, x0), dot(p1n, x1), dot(p2n, x2), dot(p3n, x3))),
    );
  },
);
