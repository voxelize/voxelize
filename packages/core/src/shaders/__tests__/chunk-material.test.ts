import {
  BoxGeometry,
  DataTexture,
  Int32BufferAttribute,
  Mesh,
  NearestFilter,
} from "three";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { createDefaultChunkMaterial } from "../materials/chunk-material";

import { createTestContext, TestContext } from "./setup";

function createTestAtlas(): DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const checker = ((x >> 2) + (y >> 2)) % 2 === 0;
      data[i] = checker ? 200 : 100;
      data[i + 1] = checker ? 180 : 80;
      data[i + 2] = checker ? 160 : 60;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size);
  tex.needsUpdate = true;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  return tex;
}

function createTestChunkGeometry(): BoxGeometry {
  const geometry = new BoxGeometry(4, 2, 4, 4, 2, 4);
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  const lightData = new Int32Array(count);

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);

    const sunlight = Math.min(15, Math.max(0, Math.floor((y + 1) * 7.5))) & 0xf;
    const red = Math.min(15, Math.max(0, Math.floor((x + 2) * 3.75))) & 0xf;
    const green = Math.min(15, Math.max(0, Math.floor((z + 2) * 3.75))) & 0xf;
    const blue = 0;
    const ao = i % 4 & 0x3;
    const isGreedy = 1;

    lightData[i] =
      (isGreedy << 19) |
      (ao << 16) |
      (sunlight << 12) |
      (red << 8) |
      (green << 4) |
      blue;
  }

  geometry.setAttribute("light", new Int32BufferAttribute(lightData, 1));
  return geometry;
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("createDefaultChunkMaterial", () => {
  it("compiles with test chunk geometry and atlas", () => {
    const atlas = createTestAtlas();
    const geometry = createTestChunkGeometry();

    const { material } = createDefaultChunkMaterial({
      atlas,
      atlasSize: 16,
    });

    const mesh = new Mesh(geometry, material);
    ctx.scene.add(mesh);
    ctx.renderer.render(ctx.scene, ctx.camera);
    ctx.scene.remove(mesh);

    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
