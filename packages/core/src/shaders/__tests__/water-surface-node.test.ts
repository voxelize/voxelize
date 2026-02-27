import { PlaneGeometry } from "three";
import { float, normalWorld, positionWorld, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { waterNormalNode, waterSurfaceNode } from "../nodes/water-surface-node";

import { createTestContext, renderWithMaterial } from "./setup";

describe("waterNormalNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with animated time", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    material.side = 2;
    const wn = waterNormalNode(positionWorld, float(1000), normalWorld);
    material.colorNode = wn.mul(0.5).add(0.5);

    const geometry = new PlaneGeometry(4, 4, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});

describe("waterSurfaceNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with full water parameters", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    material.side = 2;
    const wn = waterNormalNode(positionWorld, float(500), normalWorld);
    const baseColor = vec3(0.2, 0.4, 0.6);
    const water = waterSurfaceNode(
      baseColor,
      positionWorld,
      wn,
      vec3(0.5, 1, 0.3).normalize(),
      vec3(1, 0.98, 0.92),
      float(1),
      vec3(0.25, 0.45, 0.9),
      vec3(0.7, 0.8, 0.95),
      vec3(0.2, 0.5, 0.7),
      float(1),
      float(0),
    );
    material.colorNode = water;

    const geometry = new PlaneGeometry(4, 4, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
