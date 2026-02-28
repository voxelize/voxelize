import {
  BoxGeometry,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { buildSkinnedDepthNodes } from "../materials/depth-material";

import { createTestContext, renderWithMaterial } from "./setup";

function makeBoneTexture(): {
  tex: DataTexture;
  width: number;
  height: number;
} {
  const width = 8;
  const height = 1;
  const data = new Float32Array(width * height * 4);
  for (let bone = 0; bone < 2; bone++) {
    const base = bone * 4 * 4;
    data[base] = 1;
    data[base + 5] = 1;
    data[base + 10] = 1;
    data[base + 15] = 1;
  }
  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return { tex, width, height };
}

describe("buildSkinnedDepthNodes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles the skinned depth material", async () => {
    ctx = await createTestContext();

    const { tex, width, height } = makeBoneTexture();
    const { positionNode } = buildSkinnedDepthNodes({
      boneTexture: tex,
      boneTextureWidth: width,
      boneTextureHeight: height,
    });

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
