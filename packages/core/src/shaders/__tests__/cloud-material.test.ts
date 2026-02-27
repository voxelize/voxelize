import { PlaneGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { buildCloudNodes } from "../materials/cloud-material";

import { createTestContext, renderWithMaterial } from "./setup";

describe("buildCloudNodes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles the cloud material", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    material.side = 2;
    material.transparent = true;
    const { colorNode, opacityNode } = buildCloudNodes();
    material.colorNode = colorNode;
    material.opacityNode = opacityNode;

    const geometry = new PlaneGeometry(10, 10);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
