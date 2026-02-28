import {
  BoxGeometry,
  DataTexture,
  Int32BufferAttribute,
  NearestFilter,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { buildSwayChunkNodes } from "../materials/sway-chunk-material";

import { createTestContext, renderWithMaterial } from "./setup";

function makeAtlas(size: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = (i * 17) % 256;
    data[i * 4 + 1] = (i * 31) % 256;
    data[i * 4 + 2] = (i * 47) % 256;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, size, size);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

describe("buildSwayChunkNodes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles the sway chunk material", async () => {
    ctx = await createTestContext();

    const atlas = makeAtlas(4);
    const geometry = new BoxGeometry(1, 1, 1, 2, 2, 2);
    const count = geometry.attributes.position.count;
    const lightData = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      lightData[i] = (1 << 19) | (15 << 12);
    }
    geometry.setAttribute("light", new Int32BufferAttribute(lightData, 1));

    const { colorNode, positionNode } = buildSwayChunkNodes({
      atlas,
      atlasSize: 4,
      speed: 1,
      amplitude: 0.1,
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.positionNode = positionNode;

    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
