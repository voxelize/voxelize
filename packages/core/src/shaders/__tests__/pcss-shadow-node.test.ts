import { BoxGeometry, DataTexture, NearestFilter } from "three";
import { float, positionWorld, vec2, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { sampleShadowPCSS } from "../nodes/pcss-shadow-node";

import { createTestContext, renderWithMaterial } from "./setup";

function makeDummyShadowMap(size: number): DataTexture {
  const data = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = (x + y) / (2 * size);
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 1;
    }
  }
  const tex = new DataTexture(data, size, size);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

describe("sampleShadowPCSS", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with a dummy shadow map", async () => {
    ctx = await createTestContext();

    const shadowMap = makeDummyShadowMap(64);
    const shadowCoord = vec4(
      positionWorld.x,
      positionWorld.y,
      float(0.5),
      float(1),
    );

    const material = new MeshBasicNodeMaterial();
    const shadow = sampleShadowPCSS({
      shadowMap,
      shadowCoord,
      bias: float(0.0005),
      texelSize: vec2(1.0 / 64, 1.0 / 64),
      minOccluderDepth: float(0.0),
    });
    material.colorNode = vec3(shadow);

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
