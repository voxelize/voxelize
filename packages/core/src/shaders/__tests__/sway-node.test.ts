import { PlaneGeometry, Vector2 } from "three";
import { float, positionLocal, uniform, vec2, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { swayNode } from "../nodes/sway-node";

import { createTestContext, renderWithMaterial, TestContext } from "./setup";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("swayNode", () => {
  it("compiles as positionNode displacement", () => {
    const material = new MeshBasicNodeMaterial();
    material.positionNode = swayNode(
      positionLocal,
      uniform(5000.0),
      uniform(new Vector2(1, 0)),
      uniform(1.0),
      uniform(1.0),
      uniform(0.1),
      uniform(1.0),
      uniform(1.0),
      uniform(0.0),
    );
    material.colorNode = vec3(0.3, 0.7, 0.2);

    renderWithMaterial(ctx, new PlaneGeometry(2, 2, 16, 16), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles with rooted mode enabled", () => {
    const material = new MeshBasicNodeMaterial();
    material.positionNode = swayNode(
      positionLocal,
      uniform(3000.0),
      vec2(0.7, 0.7),
      uniform(2.0),
      uniform(1.5),
      uniform(0.2),
      float(1.0),
      float(0.5),
      uniform(1.0),
    );
    material.colorNode = vec3(0.2, 0.6, 0.1);

    renderWithMaterial(ctx, new PlaneGeometry(2, 2, 16, 16), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
