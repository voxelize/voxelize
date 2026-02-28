import { SphereGeometry } from "three";
import { positionLocal, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { simplexNoise3d } from "../nodes/simplex-noise-node";

import { createTestContext, renderWithMaterial, TestContext } from "./setup";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("simplexNoise3d", () => {
  it("compiles when assigned to colorNode", () => {
    const material = new MeshBasicNodeMaterial();
    const noise = simplexNoise3d(positionLocal);
    material.colorNode = vec3(noise.mul(0.5).add(0.5));

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles with scaled and offset position", () => {
    const material = new MeshBasicNodeMaterial();
    const scaledPos = positionLocal.mul(3.0);
    const noise = simplexNoise3d(scaledPos);
    material.colorNode = vec3(noise.mul(0.5).add(0.5));

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles when composed with other noise calls", () => {
    const material = new MeshBasicNodeMaterial();
    const pos = positionLocal.mul(2.0);
    const n1 = simplexNoise3d(pos);
    const n2 = simplexNoise3d(pos.mul(2.0));
    const combined = n1.mul(0.7).add(n2.mul(0.3));
    material.colorNode = vec3(combined.mul(0.5).add(0.5));

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
