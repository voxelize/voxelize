import { SphereGeometry } from "three";
import { float, positionLocal, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { blockOverlayNode } from "../nodes/block-overlay-node";

import { createTestContext, renderWithMaterial } from "./setup";

describe("blockOverlayNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with water overlay", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const base = vec4(positionLocal.mul(0.5).add(0.5), float(1));
    const result = blockOverlayNode(base, vec3(0.37, 0.62, 0.97), float(0.05));
    material.colorNode = result.xyz;

    const geometry = new SphereGeometry(1, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles with zero opacity (passthrough)", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const base = vec4(vec3(0.5, 0.7, 0.3), float(1));
    const result = blockOverlayNode(base, vec3(1, 0, 0), float(0));
    material.colorNode = result.xyz;

    const geometry = new SphereGeometry(1, 16, 16);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
