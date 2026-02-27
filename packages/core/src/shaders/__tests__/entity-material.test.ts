import { BoxGeometry, DataTexture, NearestFilter } from "three";
import { float, normalLocal, positionWorld, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { buildEntityColorNodes } from "../materials/entity-material";

import { createTestContext, renderWithMaterial } from "./setup";

function makeColorMap(size: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = ((x + y) * 40) % 256;
      data[i + 1] = ((x * 2 + y) * 30) % 256;
      data[i + 2] = ((x + y * 2) * 20) % 256;
      data[i + 3] = 255;
    }
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
    data[i * 4] = 0.5;
    data[i * 4 + 3] = 1;
  }
  const tex = new DataTexture(data, size, size);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

describe("buildEntityColorNodes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles the basic entity pipeline (no face UV, no shadow)", async () => {
    ctx = await createTestContext();

    const colorMap = makeColorMap(8);
    const { colorNode, opacityNode } = buildEntityColorNodes({
      colorMap,
      lightColor: vec3(1, 1, 1),
      hitEffect: float(0),
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles with face UV mapping enabled", async () => {
    ctx = await createTestContext();

    const colorMap = makeColorMap(8);
    const { colorNode } = buildEntityColorNodes({
      colorMap,
      lightColor: vec3(0.8, 0.9, 1.0),
      hitEffect: float(0.3),
      useFaceUV: true,
      partIndex: float(0),
      atlasCols: 6,
      atlasRows: 5,
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles with shadow receiving", async () => {
    ctx = await createTestContext();

    const colorMap = makeColorMap(8);
    const shadowMap = makeShadowMap(32);
    const shadowCoord = vec4(
      positionWorld.x.mul(0.5).add(0.5),
      positionWorld.y.mul(0.5).add(0.5),
      float(0.5),
      float(1),
    );

    const { colorNode } = buildEntityColorNodes({
      colorMap,
      lightColor: vec3(1, 1, 1),
      hitEffect: float(0),
      receiveShadows: true,
      shadowMap,
      shadowCoord,
      shadowMapSize: 32,
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles the full pipeline (face UV + shadow + hit)", async () => {
    ctx = await createTestContext();

    const colorMap = makeColorMap(8);
    const shadowMap = makeShadowMap(32);
    const shadowCoord = vec4(
      positionWorld.x.mul(0.5).add(0.5),
      positionWorld.y.mul(0.5).add(0.5),
      float(0.5),
      float(1),
    );

    const { colorNode, opacityNode, uniforms } = buildEntityColorNodes({
      colorMap,
      lightColor: vec3(0.9, 0.85, 0.95),
      hitEffect: float(0.2),
      useFaceUV: true,
      partIndex: float(1),
      atlasCols: 6,
      atlasRows: 5,
      receiveShadows: true,
      shadowMap,
      shadowCoord,
      shadowMapSize: 32,
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
