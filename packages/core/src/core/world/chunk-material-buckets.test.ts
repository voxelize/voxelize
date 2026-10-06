import { AABB } from "@voxelize/aabb";
import { ShaderMaterial, Texture, Uniform } from "three";
import { describe, expect, it } from "vitest";

import type { Block } from "./block";
import {
  type CustomChunkShaderMaterial,
  SHARED_CUTOUT_CUBE_MATERIAL_KEY,
  SHARED_CUTOUT_MATERIAL_KEY,
  SHARED_CUTOUT_PLANT_MATERIAL_KEY,
  SHARED_OPAQUE_MATERIAL_KEY,
  forkChunkMaterial,
  isClosedCutoutCube,
  makeChunkMaterialKey,
} from "./chunk-materials";

const solidShape = (overrides: Partial<Block> = {}): Block =>
  ({
    id: 30363,
    isOpaque: false,
    isSeeThrough: false,
    isFluid: false,
    isPlant: false,
    lightAttenuation: 0,
    transparentStandalone: false,
    ...overrides,
  }) as Block;

const host = (block: Block, customized = false) => ({
  getBlockById: () => block,
  hasCustomBlockMaterial: () => customized,
});

describe("solid-shaped block material batching", () => {
  it("batches a partial voxel with cubes without changing its occlusion flags", () => {
    const spike = solidShape();
    const stone = solidShape({ id: 1, isOpaque: true });
    expect(makeChunkMaterialKey(host(spike), spike.id)).toBe(
      SHARED_OPAQUE_MATERIAL_KEY,
    );
    expect(makeChunkMaterialKey(host(stone), stone.id)).toBe(
      SHARED_OPAQUE_MATERIAL_KEY,
    );
    expect(spike.isOpaque).toBe(false);
  });

  it("retains independent and isolated face materials", () => {
    const block = solidShape();
    expect(makeChunkMaterialKey(host(block), block.id, "screen")).toBe(
      "30363-screen",
    );
    expect(
      makeChunkMaterialKey(host(block), block.id, "screen", [-17, 6, 16]),
    ).toBe("30363-screen--17-6-16");
  });

  it("keeps blended surfaces, fluids and non-shadow-casting solids out", () => {
    for (const override of [
      { isSeeThrough: true },
      { isFluid: true },
      { castsShadow: false },
    ]) {
      const block = solidShape(override);
      expect(makeChunkMaterialKey(host(block), block.id)).toBe("30363");
    }
  });

  it("keeps a customized shape or cube in its own shader bucket", () => {
    for (const isOpaque of [true, false]) {
      const block = solidShape({ isOpaque });
      expect(makeChunkMaterialKey(host(block, true), block.id)).toBe("30363");
    }
  });

  it("isolates custom shader edits while continuing to follow world lighting", () => {
    const source = new ShaderMaterial({
      uniforms: { sunlight: new Uniform(1), map: new Uniform(new Texture()) },
    }) as CustomChunkShaderMaterial;
    source.map = source.uniforms.map.value;
    const own = forkChunkMaterial(source);
    own.vertexShader = "custom shader";
    own.uniforms.tint = new Uniform(0.5);
    source.uniforms.sunlight.value = 0.2;
    expect(source.vertexShader).not.toBe(own.vertexShader);
    expect(source.uniforms).not.toHaveProperty("tint");
    expect(own.uniforms.sunlight.value).toBe(0.2);
    expect(own.map).toBe(source.map);
    expect(own.uniforms.map.value).toBe(source.map);
  });
});

const CUBE_DIRECTIONS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const cubeFaces = (textureGroup: string | null) =>
  CUBE_DIRECTIONS.map((dir, i) => ({
    corners: [],
    dir,
    independent: false,
    isolated: false,
    textureGroup,
    range: { startU: 0, endU: 1, startV: 0, endV: 1 },
    name: `face-${i}`,
  })) as Block["faces"];

/**
 * A light-attenuating cutout cube that meshes the faces between same-id
 * neighbours to a depth: six faces of one texture, unit box.
 */
const foliageCube = (overrides: Partial<Block> = {}): Block =>
  solidShape({
    id: 41000,
    isSeeThrough: true,
    lightAttenuation: 1,
    transparentStandalone: true,
    standaloneFaceDepth: 2,
    rotatable: false,
    yRotatable: false,
    isDynamic: false,
    isAnimated: false,
    aabbs: [new AABB(0, 0, 0, 1, 1, 1)],
    faces: cubeFaces("canopy"),
    ...overrides,
  });

describe("closed cutout cubes", () => {
  it("collapses a standalone cutout cube into the single-sided bucket", () => {
    const mixedTextures = cubeFaces("canopy");
    mixedTextures[2] = { ...mixedTextures[2], textureGroup: "canopy-top" };
    for (const overrides of [
      {},
      { faces: mixedTextures },
      { rotatable: true },
      { isAnimated: true },
    ] satisfies Partial<Block>[]) {
      const block = foliageCube(overrides);
      expect(isClosedCutoutCube(block)).toBe(true);
      expect(makeChunkMaterialKey(host(block), block.id)).toBe(
        SHARED_CUTOUT_CUBE_MATERIAL_KEY,
      );
    }
  });

  it("keeps cubes with culled inner faces, or no closed box, double-sided", () => {
    const ownFace = cubeFaces("canopy");
    ownFace[0] = { ...ownFace[0], independent: true };
    for (const overrides of [
      { transparentStandalone: false },
      { standaloneFaceDepth: 0 },
      { faces: ownFace },
      { faces: cubeFaces("canopy").slice(0, 5) },
      { aabbs: [new AABB(0, 0, 0, 1, 0.5, 1)] },
      { isDynamic: true },
    ] satisfies Partial<Block>[]) {
      const block = foliageCube(overrides);
      expect(isClosedCutoutCube(block)).toBe(false);
      expect(makeChunkMaterialKey(host(block), block.id)).toBe(
        SHARED_CUTOUT_MATERIAL_KEY,
      );
    }
  });

  it("never makes plants, plain standalone cubes, fluids or customized blocks single-sided", () => {
    const plant = foliageCube({ isPlant: true });
    expect(isClosedCutoutCube(plant)).toBe(false);
    expect(makeChunkMaterialKey(host(plant), plant.id)).toBe(
      SHARED_CUTOUT_PLANT_MATERIAL_KEY,
    );

    const clear = foliageCube({ lightAttenuation: 0, standaloneFaceDepth: 0 });
    expect(isClosedCutoutCube(clear)).toBe(false);
    expect(makeChunkMaterialKey(host(clear), clear.id)).toBe(`${clear.id}`);

    const fluid = foliageCube({ isFluid: true });
    expect(isClosedCutoutCube(fluid)).toBe(false);

    const customized = foliageCube();
    expect(makeChunkMaterialKey(host(customized, true), customized.id)).toBe(
      `${customized.id}`,
    );
  });
});
