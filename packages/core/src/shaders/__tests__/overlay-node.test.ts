import { SphereGeometry } from "three";
import { float, positionLocal, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { overlayNode } from "../nodes/overlay-node";

import { createTestContext, renderWithMaterial } from "./setup";

describe("overlayNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with partial overlay", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const base = vec4(positionLocal.mul(0.5).add(0.5), float(1));
    const result = overlayNode(base, vec3(1, 0, 0), float(0.3));
    material.colorNode = result.xyz;

    const geometry = new SphereGeometry(1, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
