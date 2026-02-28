import { SphereGeometry } from "three";
import { float, positionLocal, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { hitEffectNode } from "../nodes/hit-effect-node";

import { createTestContext, renderWithMaterial } from "./setup";

describe("hitEffectNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with zero hit factor (no flash)", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    material.colorNode = hitEffectNode(
      positionLocal.mul(0.5).add(0.5),
      vec3(1, 0, 0),
      float(0),
    );

    const geometry = new SphereGeometry(1, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles with partial hit factor", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    material.colorNode = hitEffectNode(
      vec3(0.4, 0.6, 0.2),
      vec3(1, 0, 0),
      float(0.5),
    );

    const geometry = new SphereGeometry(1, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
