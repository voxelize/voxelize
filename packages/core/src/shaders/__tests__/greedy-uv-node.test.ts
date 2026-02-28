import { BoxGeometry, SphereGeometry } from "three";
import { float, normalWorld, positionWorld, uv, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { greedyUVNode } from "../nodes/greedy-uv-node";

import { createTestContext, renderWithMaterial, TestContext } from "./setup";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("greedyUVNode", () => {
  it("compiles with greedy mode enabled on a cube", () => {
    const material = new MeshBasicNodeMaterial();
    const finalUv = greedyUVNode(
      uv(),
      positionWorld,
      normalWorld,
      float(16.0),
      float(1.0),
    );
    material.colorNode = vec3(finalUv.x, finalUv.y, float(0.2));

    renderWithMaterial(ctx, new BoxGeometry(1, 1, 1), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles with greedy mode disabled (passthrough)", () => {
    const material = new MeshBasicNodeMaterial();
    const finalUv = greedyUVNode(
      uv(),
      positionWorld,
      normalWorld,
      float(16.0),
      float(0.0),
    );
    material.colorNode = vec3(finalUv.x, finalUv.y, float(0.2));

    renderWithMaterial(ctx, new SphereGeometry(1, 16, 16), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
