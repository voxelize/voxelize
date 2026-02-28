import { BoxGeometry, DataTexture, NearestFilter } from "three";
import { float, normalWorld, positionWorld, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import {
  withFog,
  withHitEffect,
  withLight,
  withShadow,
} from "../nodes/material-effects";

import { createTestContext, renderWithMaterial } from "./setup";

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

describe("material-effects", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("withLight multiplies color by light", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const base = normalWorld.mul(0.5).add(0.5);
    material.colorNode = withLight(base, vec3(0.8, 0.6, 1.0));

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("withHitEffect applies hit flash", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const base = vec3(0.5, 0.7, 0.3);
    material.colorNode = withHitEffect(base, vec3(1, 0, 0), float(0.4));

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("withShadow applies entity shadow", async () => {
    ctx = await createTestContext();

    const shadowMap = makeShadowMap(32);
    const material = new MeshBasicNodeMaterial();
    const base = vec3(0.8, 0.8, 0.8);
    material.colorNode = withShadow(base, {
      worldNormal: normalWorld,
      sunDirection: vec3(0.5, 1, 0.3).normalize(),
      viewDepth: positionWorld.sub(vec3(0, 0, 3)).length(),
      shadowMap,
      shadowCoord: vec4(
        positionWorld.x.mul(0.5).add(0.5),
        positionWorld.y.mul(0.5).add(0.5),
        float(0.5),
        float(1),
      ),
      cascadeSplit1: float(48),
      shadowBias: float(0.0005),
      shadowNormalBias: float(0.01),
      shadowStrength: float(1.0),
      sunlightIntensity: float(1.0),
      minOccluderDepth: float(0.0),
      shadowMapSize: 32,
    });

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("withFog applies distance fog", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const base = vec3(0.3, 0.6, 0.2);
    material.colorNode = withFog(base, {
      worldPosition: positionWorld,
      fogColor: vec3(0.7, 0.75, 0.85),
      fogNear: float(1),
      fogFar: float(5),
      fogHeightOrigin: float(0.5),
      fogHeightDensity: float(1.0),
    });

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("chains all effects together", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    let color: ReturnType<typeof float> = vec3(0.6, 0.4, 0.2);
    color = withLight(color, vec3(0.9, 0.85, 1.0));
    color = withHitEffect(color, vec3(1, 0, 0), float(0.1));
    color = withFog(color, {
      worldPosition: positionWorld,
      fogColor: vec3(0.7, 0.75, 0.85),
      fogNear: float(2),
      fogFar: float(8),
      fogHeightOrigin: float(0),
      fogHeightDensity: float(0.5),
    });
    material.colorNode = color;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
