import { AABB } from "@voxelize/aabb";
import { MeshBasicMaterial, RenderTarget, Texture } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";

import type { Block } from "./block";
import {
  ChunkMaterial,
  SHARED_CUTOUT_CUBE_MATERIAL_KEY,
  SHARED_CUTOUT_MATERIAL_KEY,
  SHARED_CUTOUT_PLANT_MATERIAL_KEY,
  SHARED_OPAQUE_MATERIAL_KEY,
  SEE_THROUGH_ALPHA_TEST,
  forkChunkMaterial,
  isClosedCutoutCube,
  makeChunkMaterialKey,
  sharedCutoutBlending,
  sharedFaceCustomizationError,
} from "./chunk-materials";
import type { ChunkShadingInputs } from "./shading/chunk-material";

// The world's shading inputs are only read when a program builds; forking
// and copying never touch them, so an identity stands in for them here.
const shading = { id: 1 } as unknown as ChunkShadingInputs;

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
    const source = new ChunkMaterial(shading, { kind: "opaque" });
    source.map = new Texture();
    source.chunkReveal = 0.5;
    const own = forkChunkMaterial(source);
    // Same program and the very same world inputs (uniform nodes), so a
    // change to the world's lighting reaches both.
    expect(own).not.toBe(source);
    expect(own.shading).toBe(source.shading);
    expect(own.variantKey).toBe(source.variantKey);
    expect(own.map).toBe(source.map);
    expect(own.chunkReveal).toBe(0.5);
    // A shader edit on the fork stays on the fork.
    own.setVariant({ sway: { amplitude: 0.3 }, hooks: { key: "custom" } });
    expect(own.variantKey).not.toBe(source.variantKey);
    expect(source.chunkOptions.hooks).toBeNull();
    expect(source.chunkOptions.sway).toBeNull();
    // Per-material values are its own copies.
    own.chunkReveal = 1;
    own.surfaceOpenLight.set(0, 0);
    expect(source.chunkReveal).toBe(0.5);
    expect(source.surfaceOpenLight.x).not.toBe(0);
  });

  it("forks a material reading a render target without trying to copy it", () => {
    const sceneColor = new RenderTarget(4, 4).texture;
    const source = new ChunkMaterial(shading, { kind: "fluid" });
    source.map = sceneColor;
    const placeholder = new ChunkMaterial(shading, { kind: "fluid" }).map;
    const placeholderImage = placeholder.image;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const own = forkChunkMaterial(source);
      expect(warn).not.toHaveBeenCalled();
      expect(own.map).toBe(sceneColor);
      expect(source.map).toBe(sceneColor);
      // The shared placeholder was not overwritten by a deep copy.
      expect(placeholder.image).toBe(placeholderImage);
    } finally {
      warn.mockRestore();
    }
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

describe("shared cutout blending", () => {
  it("draws a leaf canopy opaque at half coverage and keeps the rest blended", () => {
    // Blended, a leaf face's mip-averaged half alpha read as plastic wrap.
    expect(sharedCutoutBlending(true)).toEqual({
      transparent: false,
      alphaTest: 0.5,
    });
    expect(sharedCutoutBlending(false)).toEqual({
      transparent: true,
      alphaTest: SEE_THROUGH_ALPHA_TEST,
    });
  });
});

describe("face shader customization on a shared bucket", () => {
  const plant = new MeshBasicMaterial();
  const own = new MeshBasicMaterial();
  const materials = new Map([
    [SHARED_CUTOUT_PLANT_MATERIAL_KEY, plant],
    [SHARED_OPAQUE_MATERIAL_KEY, new MeshBasicMaterial()],
    ["40001-one", own],
  ]);

  it("refuses a face whose material is the shared bucket's", () => {
    const error = sharedFaceCustomizationError(
      "Staged Plant",
      "s0-one",
      plant,
      materials,
    );
    expect(error?.message).toContain(SHARED_CUTOUT_PLANT_MATERIAL_KEY);
    expect(error?.message).toContain("setBlockSway");
  });

  it("allows a face that owns its material, and a whole-block customization", () => {
    expect(
      sharedFaceCustomizationError("Flame", "one", own, materials),
    ).toBeNull();
    expect(
      sharedFaceCustomizationError("Staged Plant", null, plant, materials),
    ).toBeNull();
  });
});
