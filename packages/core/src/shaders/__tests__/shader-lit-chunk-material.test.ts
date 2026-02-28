import {
  BoxGeometry,
  DataTexture,
  Float32BufferAttribute,
  Int32BufferAttribute,
  NearestFilter,
  RGBAFormat,
  FloatType,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { buildShaderLitChunkNodes } from "../materials/shader-lit-chunk-material";

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

function makeShadowMap(size: number): DataTexture {
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 0.8;
    data[i * 4 + 3] = 1;
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

describe("buildShaderLitChunkNodes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles the full shader-lit chunk pipeline", async () => {
    ctx = await createTestContext();

    const atlas = makeAtlas(4);
    const sm0 = makeShadowMap(32);
    const sm1 = makeShadowMap(32);
    const sm2 = makeShadowMap(32);

    const geometry = new BoxGeometry(2, 2, 2, 2, 2, 2);
    const posAttr = geometry.attributes.position;
    const count = posAttr.count;
    const lightData = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const y = posAttr.getY(i);
      const sunlight =
        Math.min(15, Math.max(0, Math.floor((y + 1) * 7.5))) & 0xf;
      const ao = i % 4 & 0x3;
      lightData[i] = (1 << 19) | (ao << 16) | (sunlight << 12) | (5 << 8);
    }
    geometry.setAttribute("light", new Int32BufferAttribute(lightData, 1));

    const { colorNode } = buildShaderLitChunkNodes({
      atlas,
      atlasSize: 4,
      shadowMaps: [sm0, sm1, sm2],
      shadowMapSize: 32,
    });

    const material = new MeshBasicNodeMaterial();
    material.side = 2;
    material.colorNode = colorNode;

    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
