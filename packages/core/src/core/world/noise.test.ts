import { WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { simplexNoise3 } from "./fluid-waves";
import { simplexNoise3Node } from "./shading/noise";

type V = number[];

const zip = (a: V, b: V, f: (x: number, y: number) => number): V =>
  (a.length >= b.length ? a : b).map((_, k) =>
    f(a[a.length === 1 ? 0 : k], b[b.length === 1 ? 0 : k]),
  );
const mod = (a: V, b: V) => zip(a, b, (x, m) => x - m * Math.floor(x / m));
const vec =
  (n: number) =>
  (...parts: V[]): V => {
    const flat = parts.flat();
    return flat.length === 1 ? new Array(n).fill(flat[0]) : flat;
  };
const CALLS: Record<string, (...args: V[]) => V> = {
  abs: (a) => a.map(Math.abs),
  dot: (a, b) => [a.reduce((sum, x, k) => sum + x * b[k], 0)],
  floor: (a) => a.map(Math.floor),
  max: (a, b) => zip(a, b, Math.max),
  min: (a, b) => zip(a, b, Math.min),
  step: (edge, x) => zip(edge, x, (e, v) => (v < e ? 0 : 1)),
  tsl_mod_vec3: mod,
  tsl_mod_vec4: mod,
  "vec2<f32>": vec(2),
  "vec3<f32>": vec(3),
  "vec4<f32>": vec(4),
};
const OPS: Record<string, (x: number, y: number) => number> = {
  "+": (x, y) => x + y,
  "-": (x, y) => x - y,
  "*": (x, y) => x * y,
  "/": (x, y) => x / y,
};

// TSL parenthesizes every operator it emits, so no precedence is needed.
function evaluate(source: string, scope: Map<string, V>): V {
  const tokens = source.match(/\d+(?:\.\d+)?(?:e[-+]?\d+)?|\w+(?:<f32>)?|\S/g);
  if (!tokens) throw new Error(`no WGSL expression in "${source}"`);
  let at = 0;
  const operand = (): V => {
    const token = tokens[at++];
    let value: V;
    if (token === "-") {
      value = operand().map((x) => -x);
    } else if (token === "(") {
      value = expression();
      at++;
    } else if (/^\d/.test(token)) {
      value = [Number(token)];
    } else if (tokens[at] === "(") {
      const call = CALLS[token];
      if (!call) throw new Error(`no JS for the WGSL call ${token}`);
      const args: V[] = [];
      do {
        at++;
        args.push(expression());
      } while (tokens[at] === ",");
      at++;
      value = call(...args);
    } else {
      const named = scope.get(token);
      if (!named) throw new Error(`unknown WGSL name ${token}`);
      value = named;
    }
    while (tokens[at] === ".") {
      const source = value;
      value = [...tokens[at + 1]].map((c) => source["xyzw".indexOf(c)]);
      at += 2;
    }
    return value;
  };
  const expression = (): V => {
    let value = operand();
    while (tokens[at] in OPS) {
      const op = OPS[tokens[at++]];
      value = zip(value, operand(), op);
    }
    return value;
  };
  return expression();
}

/**
 * The WGSL WebGPU compiles for `simplexNoise3Node`, run statement by
 * statement. TSL emits an expression where it is first read, so what the
 * shader computes shows only in the generated statements, in their order.
 */
function generatedNoise(): (v: V) => number {
  const Builder = WGSLNodeBuilder as unknown as new (
    object: null,
    renderer: object,
  ) => { buildFunctionCode(shaderNode: unknown): string };
  const code = new Builder(null, {
    debug: { diagnostics: { keywords: false } },
  }).buildFunctionCode(simplexNoise3Node.shaderNode);
  const statements = code
    .slice(code.indexOf("{") + 1, code.lastIndexOf("}"))
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "" && !statement.startsWith("var "));
  return (v) => {
    const scope = new Map([["v", v]]);
    for (const statement of statements) {
      if (statement.startsWith("return ")) {
        return evaluate(statement.slice("return ".length), scope)[0];
      }
      const [, name, value] = /^(?:let )?(\w+) = ([^]+)$/.exec(statement) ?? [];
      if (!name) {
        throw new Error(`cannot run the WGSL statement "${statement}"`);
      }
      scope.set(name, evaluate(value, scope));
    }
    throw new Error(`no return in\n${code}`);
  };
}

describe("the shader's simplex noise", () => {
  const noise = generatedNoise();

  it("is not zero below 0 or from 289 on, where the lattice wraps", () => {
    for (const v of [
      [-0.5, -7.25, 3],
      [-150.5, 20.25, -9],
      [289.5, 0.25, 1],
      [1500.25, -800.5, 10],
    ]) {
      expect(Math.abs(noise(v))).toBeGreaterThan(0.05);
    }
  });

  it("agrees with its CPU twin on both sides of the wrap", () => {
    for (let i = 0; i < 400; i++) {
      const v = [
        Math.sin(i * 12.9898) * 1500,
        Math.cos(i * 78.233) * 1500,
        (i % 7) * 100 - 300,
      ];
      expect(noise(v)).toBeCloseTo(simplexNoise3(v[0], v[1], v[2]), 10);
    }
  });
});
