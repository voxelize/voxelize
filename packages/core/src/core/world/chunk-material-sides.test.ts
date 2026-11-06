import { describe, expect, it } from "vitest";

import {
  ChunkMaterial,
  type ChunkShadingInputs,
} from "./shading/chunk-material";

// Shading inputs are only read when a program builds.
const world = { id: 1 } as unknown as ChunkShadingInputs;

// A double-sided see-through draw is two passes, back faces then front, and
// a material whose program never reads its side builds once for both.
describe("chunk material sides", () => {
  it("says every kind but the fluid builds one program for all sides", () => {
    for (const kind of ["opaque", "cutout", "seeThrough"] as const) {
      expect(new ChunkMaterial(world, { kind }).isSideAgnosticProgram).toBe(
        true,
      );
    }
    // In air only the water's outward face draws (`frontFacing`).
    expect(
      new ChunkMaterial(world, { kind: "fluid" }).isSideAgnosticProgram,
    ).toBe(false);
  });

  it("follows the kind a material is rebuilt for", () => {
    const material = new ChunkMaterial(world, { kind: "seeThrough" });
    material.setVariant({ kind: "fluid" });
    expect(material.isSideAgnosticProgram).toBe(false);
    material.setVariant({ kind: "cutout" });
    expect(material.isSideAgnosticProgram).toBe(true);
  });
});
