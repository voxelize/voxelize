import { describe, expect, it } from "vitest";

import {
  ChunkMaterial,
  type ChunkShadingInputs,
} from "./shading/chunk-material";

// Shading inputs are only read when a program builds.
const world = { id: 1 } as unknown as ChunkShadingInputs;
const otherWorld = { id: 2 } as unknown as ChunkShadingInputs;

const quantized = (material: ChunkMaterial) => {
  material.positionUnits = 512;
  return material;
};

// A depth pass that overrides the material (the sun's cascades, the local
// lights' shadow faces) keeps only a caster's `positionNode`.
describe("chunk caster displacement", () => {
  it("gives every swaying variant a position for the depth passes, shared per variant", () => {
    const a = quantized(new ChunkMaterial(world, { kind: "cutout" }));
    const b = quantized(new ChunkMaterial(world, { kind: "cutout" }));
    expect(a.positionNode).toBeTruthy();
    // One node, so one depth graph for every material of the variant.
    expect(b.positionNode).toBe(a.positionNode);

    const swaying = quantized(
      new ChunkMaterial(world, { kind: "seeThrough", sway: { speed: 2 } }),
    );
    expect(swaying.positionNode).toBeTruthy();
    expect(swaying.positionNode).not.toBe(a.positionNode);
  });

  it("hands a GPU-drawn material one node, the same on every read", () => {
    // Its `positionNode` is read into the program key whenever three keys
    // the material: a node made per read gave every GPU-drawn material a
    // program of its own, rebuilt on every rekeying.
    const gpu = (material: ChunkMaterial) => {
      material.drawsGpuSections = true;
      return quantized(material);
    };
    const a = gpu(new ChunkMaterial(world, { kind: "cutout" }));
    const b = gpu(new ChunkMaterial(world, { kind: "cutout" }));
    expect(a.positionNode).toBeTruthy();
    expect(a.positionNode).toBe(a.positionNode);
    expect(b.positionNode).toBe(a.positionNode);
    expect(a.customProgramCacheKey()).toBe(a.customProgramCacheKey());
    expect(b.customProgramCacheKey()).toBe(a.customProgramCacheKey());
    // Still apart from a material drawn by a region arena.
    const arena = quantized(new ChunkMaterial(world, { kind: "cutout" }));
    expect(arena.positionNode).not.toBe(a.positionNode);
  });

  it("keys the node by world and position format", () => {
    const quant = quantized(new ChunkMaterial(world, { kind: "cutout" }));
    const float = new ChunkMaterial(world, { kind: "cutout" });
    const elsewhere = quantized(
      new ChunkMaterial(otherWorld, { kind: "cutout" }),
    );
    expect(float.positionNode).not.toBe(quant.positionNode);
    expect(elsewhere.positionNode).not.toBe(quant.positionNode);
  });

  it("leaves still, depth-only and hook-displaced materials at rest", () => {
    expect(
      new ChunkMaterial(world, { kind: "opaque" }).positionNode,
    ).toBeNull();
    expect(
      new ChunkMaterial(world, { kind: "cutout", depthOnly: true })
        .positionNode,
    ).toBeNull();
    const hooked = new ChunkMaterial(world, {
      kind: "cutout",
      hooks: { key: "bob", displace: () => null as never },
    } as never);
    expect(hooked.positionNode).toBeNull();
  });

  it("follows a variant change and ignores writes", () => {
    const material = quantized(new ChunkMaterial(world, { kind: "opaque" }));
    expect(material.positionNode).toBeNull();
    material.setVariant({ kind: "cutout" });
    const node = material.positionNode;
    expect(node).toBeTruthy();
    // A write (NodeMaterial.copy assigns it) changes nothing.
    material.positionNode = null;
    expect(material.positionNode).toBe(node);
  });
});
