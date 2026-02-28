import { DataTexture, NearestFilter, ShaderMaterial } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { buildDefaultChunkNodes } from "../materials/chunk-material";
import { buildCloudNodes } from "../materials/cloud-material";
import { buildShaderLitChunkNodes } from "../materials/shader-lit-chunk-material";
import { buildSkyNodes } from "../materials/sky-material";

import { createTestContext, renderWithMaterial } from "./setup";

function makeDummyTexture(size: number): DataTexture {
  const data = new Uint8Array(size * size * 4).fill(128);
  const tex = new DataTexture(data, size, size);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

describe("node material compatibility", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("buildDefaultChunkNodes produces a node that compiles with MeshBasicNodeMaterial", async () => {
    ctx = await createTestContext();

    const atlas = makeDummyTexture(4);
    const { colorNode } = buildDefaultChunkNodes({ atlas, atlasSize: 4 });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    expect(material).not.toBeInstanceOf(ShaderMaterial);
    expect(material.isNodeMaterial).toBe(true);
  });

  it("buildShaderLitChunkNodes produces a node that compiles with MeshBasicNodeMaterial", async () => {
    ctx = await createTestContext();

    const atlas = makeDummyTexture(4);
    const sm = makeDummyTexture(32);
    const { colorNode } = buildShaderLitChunkNodes({
      atlas,
      atlasSize: 4,
      shadowMaps: [sm, sm, sm],
      shadowMapSize: 32,
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    expect(material).not.toBeInstanceOf(ShaderMaterial);
    expect(material.isNodeMaterial).toBe(true);
  });

  it("buildSkyNodes produces a node-compatible material", async () => {
    ctx = await createTestContext();

    const { colorNode } = buildSkyNodes();
    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    expect(material).not.toBeInstanceOf(ShaderMaterial);
    expect(material.isNodeMaterial).toBe(true);
  });

  it("buildCloudNodes produces a node-compatible material", async () => {
    ctx = await createTestContext();

    const { colorNode, opacityNode } = buildCloudNodes();
    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.opacityNode = opacityNode;

    expect(material).not.toBeInstanceOf(ShaderMaterial);
    expect(material.isNodeMaterial).toBe(true);
  });

  it("all TSL materials render without ShaderMaterial errors", async () => {
    ctx = await createTestContext();

    const atlas = makeDummyTexture(4);
    const { colorNode } = buildDefaultChunkNodes({ atlas, atlasSize: 4 });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    const { BoxGeometry } = await import("three");
    const geometry = new BoxGeometry(1, 1, 1);

    const lightData = new Int32Array(geometry.attributes.position.count);
    for (let i = 0; i < lightData.length; i++) {
      lightData[i] = (1 << 19) | (15 << 12);
    }
    const { Int32BufferAttribute } = await import("three");
    geometry.setAttribute("light", new Int32BufferAttribute(lightData, 1));

    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
