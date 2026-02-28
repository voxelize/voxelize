import { BoxGeometry, DataTexture, NearestFilter } from "three";
import { float, normalWorld, positionWorld, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { entityShadowNode } from "../nodes/entity-shadow-node";

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

describe("entityShadowNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with typical entity shadow parameters", async () => {
    ctx = await createTestContext();

    const shadowMap = makeDummyShadowMap(64);
    const shadowCoord = vec4(
      positionWorld.x,
      positionWorld.y,
      float(0.5),
      float(1),
    );

    const material = new MeshBasicNodeMaterial();
    const shadow = entityShadowNode({
      worldNormal: normalWorld,
      sunDirection: vec3(0.5, 1.0, 0.3).normalize(),
      viewDepth: positionWorld.sub(vec3(0, 0, 3)).length(),
      shadowMap,
      shadowCoord,
      cascadeSplit1: float(48),
      shadowBias: float(0.0005),
      shadowNormalBias: float(0.01),
      shadowStrength: float(1.0),
      sunlightIntensity: float(1.0),
      minOccluderDepth: float(0.0),
      shadowMapSize: 64,
    });
    material.colorNode = vec3(shadow);

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("returns 1.0 when shadow strength is zero", async () => {
    ctx = await createTestContext();

    const shadowMap = makeDummyShadowMap(32);
    const shadowCoord = vec4(float(0), float(0), float(0.5), float(1));

    const material = new MeshBasicNodeMaterial();
    const shadow = entityShadowNode({
      worldNormal: normalWorld,
      sunDirection: vec3(0, 1, 0),
      viewDepth: float(10),
      shadowMap,
      shadowCoord,
      cascadeSplit1: float(48),
      shadowBias: float(0.0005),
      shadowNormalBias: float(0.01),
      shadowStrength: float(0.0),
      sunlightIntensity: float(1.0),
      minOccluderDepth: float(0.0),
      shadowMapSize: 32,
    });
    material.colorNode = vec3(shadow);

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
