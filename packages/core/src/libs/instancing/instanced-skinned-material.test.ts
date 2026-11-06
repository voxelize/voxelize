import { Color, DataTexture, DoubleSide, FloatType, RGBAFormat, Texture } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { sharedEntityShadowUniforms } from "../../core/world/entity-shadow-uniforms";
import { isLightConesCovered } from "../../core/world/light-cones";

import {
  type InstancedSkinnedMaterialOptions,
  InstancedSkinnedMaterial,
} from "./instanced-skinned-material";

const bones = () =>
  new DataTexture(new Float32Array(16 * 4), 4, 4, RGBAFormat, FloatType);

const make = (options: InstancedSkinnedMaterialOptions = {}, width = 4) =>
  new InstancedSkinnedMaterial(bones(), width, 4, 1, options);

describe("instanced skinned materials", () => {
  it("share one program across kinds and coats with the same options", () => {
    const fox = make({ partCount: 6, receiveShadows: true });
    const wolf = make(
      {
        partCount: 6,
        receiveShadows: true,
        map: new Texture(),
        color: new Color(0.4, 0.3, 0.2),
        opacity: 0.5,
        shadowSelfBoundsMargin: 0.4,
      },
      8,
    );
    expect(wolf.customProgramCacheKey()).toBe(fox.customProgramCacheKey());
    // What differs between them is per-material data, read each draw.
    expect(wolf.boneTexture).not.toBe(fox.boneTexture);
    expect(wolf.boneTextureWidth).toBe(8);
    expect(wolf.tint.equals(new Color(0.4, 0.3, 0.2))).toBe(true);
    expect(wolf.opacityValue).toBe(0.5);
    expect(wolf.shadowSelfBoundsMargin).toBe(0.4);
    expect(wolf.colorMap).not.toBe(fox.colorMap);
  });

  it("key apart the options their graph is built from", () => {
    const base = make().customProgramCacheKey();
    expect(make({ useFaceUV: true }).customProgramCacheKey()).not.toBe(base);
    expect(make({ useVertexColor: true }).customProgramCacheKey()).not.toBe(base);
    expect(
      make({
        emissiveFace: { partIndex: 0, faceIndex: 4, color: new Color(1, 1, 0) },
      }).customProgramCacheKey(),
    ).not.toBe(base);
  });

  it("read the world's shadow block in world, one studio block otherwise", () => {
    const inWorld = make();
    expect(inWorld.shadowUniforms).toBe(sharedEntityShadowUniforms);
    const portrait = make({ isEnvironmentBound: false });
    const thumbnail = make({ isEnvironmentBound: false, side: DoubleSide });
    expect(portrait.shadowUniforms).not.toBe(sharedEntityShadowUniforms);
    expect(thumbnail.shadowUniforms).toBe(portrait.shadowUniforms);
    // A studio graph never serves a world material.
    expect(portrait.customProgramCacheKey()).not.toBe(
      inWorld.customProgramCacheKey(),
    );
  });

  it("count as shading with the light cones", () => {
    expect(isLightConesCovered(make())).toBe(true);
  });
});
