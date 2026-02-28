import { SphereGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { buildSkyNodes } from "../materials/sky-material";

import { createTestContext, renderWithMaterial } from "./setup";

describe("buildSkyNodes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles the sky material", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    material.side = 1;
    const { colorNode } = buildSkyNodes();
    material.colorNode = colorNode;

    const geometry = new SphereGeometry(10, 32, 32);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
