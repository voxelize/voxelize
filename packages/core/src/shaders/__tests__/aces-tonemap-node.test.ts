import { SphereGeometry } from "three";
import { normalWorld, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { acesTonemapNode } from "../nodes/aces-tonemap-node";

import { createTestContext, renderWithMaterial } from "./setup";

describe("acesTonemapNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with HDR-range input", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const hdrColor = normalWorld.mul(0.5).add(0.5).mul(2.0);
    material.colorNode = acesTonemapNode(hdrColor);

    const geometry = new SphereGeometry(1, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles with low-range input", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    material.colorNode = acesTonemapNode(vec3(0.1, 0.2, 0.3));

    const geometry = new SphereGeometry(1, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
