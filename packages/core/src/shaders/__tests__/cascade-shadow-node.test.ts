import {
  SphereGeometry,
  Vector3,
  DataTexture,
  RedFormat,
  FloatType,
} from "three";
import { float, normalWorld, uniform, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { cascadeShadowNode } from "../nodes/cascade-shadow-node";

import { createTestContext, renderWithMaterial, TestContext } from "./setup";

function createDummyShadowMap(size: number) {
  const tex = new DataTexture(
    new Float32Array(size * size).fill(1.0),
    size,
    size,
    RedFormat,
    FloatType,
  );
  tex.needsUpdate = true;
  return tex;
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("cascadeShadowNode", () => {
  it("compiles with 3 cascade shadow maps", () => {
    const shadowMap = createDummyShadowMap(16);

    const material = new MeshBasicNodeMaterial();
    const shadow = cascadeShadowNode({
      worldNormal: normalWorld,
      sunDirection: uniform(new Vector3(0.5, 1, 0.3).normalize()),
      sunExposure: float(1.0),
      viewDepth: float(10.0),
      shadowCoords: [
        vec4(0.5, 0.5, 0.5, 1.0),
        vec4(0.5, 0.5, 0.5, 1.0),
        vec4(0.5, 0.5, 0.5, 1.0),
      ],
      shadowMaps: [shadowMap, shadowMap, shadowMap],
      cascadeSplits: [float(20.0), float(80.0), float(200.0)],
      shadowBias: float(0.001),
      shadowStrength: float(0.8),
      shadowMapSize: 16,
    });

    material.colorNode = vec3(shadow);
    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles with zero shadow strength (early-out path)", () => {
    const shadowMap = createDummyShadowMap(16);

    const material = new MeshBasicNodeMaterial();
    const shadow = cascadeShadowNode({
      worldNormal: normalWorld,
      sunDirection: uniform(new Vector3(0, 1, 0)),
      sunExposure: float(1.0),
      viewDepth: float(50.0),
      shadowCoords: [
        vec4(0.5, 0.5, 0.3, 1.0),
        vec4(0.5, 0.5, 0.3, 1.0),
        vec4(0.5, 0.5, 0.3, 1.0),
      ],
      shadowMaps: [shadowMap, shadowMap, shadowMap],
      cascadeSplits: [float(30.0), float(100.0), float(250.0)],
      shadowBias: float(0.002),
      shadowStrength: float(0.0),
      shadowMapSize: 16,
    });

    material.colorNode = vec3(shadow);
    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
