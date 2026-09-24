import { ShaderMaterial, Texture, Uniform } from "three";
import { describe, expect, it } from "vitest";

import type { Block } from "./block";
import {
  type CustomChunkShaderMaterial,
  SHARED_OPAQUE_MATERIAL_KEY,
  forkChunkMaterial,
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
