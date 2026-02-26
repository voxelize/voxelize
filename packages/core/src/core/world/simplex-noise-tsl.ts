import {
  Fn,
  abs,
  dot,
  floor,
  max,
  min,
  mod,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node, ShaderNodeObject } from "three/tsl";

const permuteFn = Fn(({ x }) => {
  return mod(x.mul(34.0).add(1.0).mul(x), 289.0);
}).setLayout({
  name: "permute",
  type: "vec4",
  inputs: [{ name: "x", type: "vec4" }],
});

const taylorInvSqrtFn = Fn(({ r }) => {
  return vec4(1.79284291400159).sub(r.mul(0.85373472095314));
}).setLayout({
  name: "taylorInvSqrt",
  type: "vec4",
  inputs: [{ name: "r", type: "vec4" }],
});

const simplexNoise3dImpl = Fn(({ v }) => {
  const C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const D = vec4(0.0, 0.5, 1.0, 2.0);

  const i = floor(v.add(dot(v, vec3(C.y)))).toVar();
  const x0 = v
    .sub(i)
    .add(dot(i, vec3(C.x)))
    .toVar();

  const g = step(vec3(x0.y, x0.z, x0.x), x0).toVar();
  const l = vec3(1.0).sub(g).toVar();
  const i1 = min(g, vec3(l.z, l.x, l.y)).toVar();
  const i2 = max(g, vec3(l.z, l.x, l.y)).toVar();

  const x1 = x0.sub(i1).add(vec3(C.x)).toVar();
  const x2 = x0
    .sub(i2)
    .add(vec3(C.x.mul(2.0)))
    .toVar();
  const x3 = x0
    .sub(1.0)
    .add(vec3(C.x.mul(3.0)))
    .toVar();

  i.assign(mod(i, 289.0));

  const p = permuteFn({
    x: permuteFn({
      x: permuteFn({
        x: i.z.add(vec4(0.0, i1.z, i2.z, 1.0)),
      })
        .add(i.y)
        .add(vec4(0.0, i1.y, i2.y, 1.0)),
    })
      .add(i.x)
      .add(vec4(0.0, i1.x, i2.x, 1.0)),
  }).toVar();

  const n_ = 1.0 / 7.0;
  const ns = vec3(D.w, D.y, D.z)
    .mul(n_)
    .sub(vec3(D.x, D.z, D.x))
    .toVar();

  const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49.0)).toVar();

  const x_ = floor(j.mul(ns.z)).toVar();
  const y_ = floor(j.sub(x_.mul(7.0))).toVar();

  const x = x_.mul(ns.x).add(vec4(ns.y)).toVar();
  const y = y_.mul(ns.x).add(vec4(ns.y)).toVar();
  const h = vec4(1.0).sub(abs(x)).sub(abs(y)).toVar();

  const b0 = vec4(x.x, x.y, y.x, y.y).toVar();
  const b1 = vec4(x.z, x.w, y.z, y.w).toVar();

  const s0 = floor(b0).mul(2.0).add(1.0).toVar();
  const s1 = floor(b1).mul(2.0).add(1.0).toVar();
  const sh = step(h, vec4(0.0)).mul(-1.0).toVar();

  const a0 = vec4(b0.x, b0.z, b0.y, b0.w)
    .add(vec4(s0.x, s0.z, s0.y, s0.w).mul(vec4(sh.x, sh.x, sh.y, sh.y)))
    .toVar();
  const a1 = vec4(b1.x, b1.z, b1.y, b1.w)
    .add(vec4(s1.x, s1.z, s1.y, s1.w).mul(vec4(sh.z, sh.z, sh.w, sh.w)))
    .toVar();

  const p0 = vec3(a0.x, a0.y, h.x).toVar();
  const p1 = vec3(a0.z, a0.w, h.y).toVar();
  const p2 = vec3(a1.x, a1.y, h.z).toVar();
  const p3 = vec3(a1.z, a1.w, h.w).toVar();

  const norm = taylorInvSqrtFn({
    r: vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)),
  }).toVar();
  p0.assign(p0.mul(norm.x));
  p1.assign(p1.mul(norm.y));
  p2.assign(p2.mul(norm.z));
  p3.assign(p3.mul(norm.w));

  const m = max(
    vec4(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))),
    vec4(0.0),
  ).toVar();
  m.assign(m.mul(m));

  return dot(
    m.mul(m),
    vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)),
  ).mul(42.0);
}).setLayout({
  name: "snoise",
  type: "float",
  inputs: [{ name: "v", type: "vec3" }],
});

export const simplexNoise3dFn: (
  position: ShaderNodeObject<Node>,
) => ShaderNodeObject<Node> = (position) => simplexNoise3dImpl({ v: position });
