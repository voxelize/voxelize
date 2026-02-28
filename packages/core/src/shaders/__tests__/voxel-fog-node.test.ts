import { SphereGeometry, Color } from "three";
import { positionWorld, vec3, uniform } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { voxelFogNode } from "../nodes/voxel-fog-node";

import { createTestContext, renderWithMaterial, TestContext } from "./setup";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("voxelFogNode", () => {
  it("compiles when applied to a solid base color", () => {
    const material = new MeshBasicNodeMaterial();
    material.colorNode = voxelFogNode(
      vec3(1.0, 0.0, 0.0),
      positionWorld,
      uniform(new Color(0.8, 0.85, 0.9)),
      uniform(50.0),
      uniform(200.0),
      uniform(64.0),
      uniform(0.02),
    );

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles when chained with another color node as input", () => {
    const material = new MeshBasicNodeMaterial();
    const baseColor = positionWorld.normalize().mul(0.5).add(0.5);
    material.colorNode = voxelFogNode(
      baseColor,
      positionWorld,
      uniform(new Color(0.5, 0.5, 0.5)),
      uniform(1.0),
      uniform(10.0),
      uniform(0.0),
      uniform(0.5),
    );

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
