import { PlaneGeometry } from "three";
import { float, positionWorld, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { cloudColorNode } from "../nodes/cloud-node";

import { createTestContext, renderWithMaterial } from "./setup";

describe("cloudColorNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with standard cloud parameters", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const result = cloudColorNode(
      positionWorld,
      vec3(0.95, 0.95, 0.95),
      float(0.8),
      vec3(0.7, 0.75, 0.85),
      float(50),
      float(200),
    );
    material.colorNode = result.xyz;

    const geometry = new PlaneGeometry(10, 10);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles with dense fog settings", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const result = cloudColorNode(
      positionWorld,
      vec3(1, 1, 1),
      float(1.0),
      vec3(0.5, 0.6, 0.7),
      float(10),
      float(50),
    );
    material.colorNode = result.xyz;

    const geometry = new PlaneGeometry(4, 4);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
