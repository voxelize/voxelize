import type { Texture } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { pickTextureRegion } from "./block-texture";
import type { ParticleTexture, UVRegion } from "./types";

const cell = (i: number): UVRegion => ({
  startU: i / 4,
  endU: (i + 1) / 4,
  startV: 0,
  endV: 1,
});

const sheet = (variants?: UVRegion[]): ParticleTexture => ({
  key: "sheet",
  map: {} as Texture,
  region: cell(0),
  patchFraction: 1,
  variants,
});

describe("a particle's texture region", () => {
  it("is the texture's own region when it draws one way", () => {
    expect(pickTextureRegion(sheet(), undefined, () => 0.9)).toEqual(cell(0));
    expect(pickTextureRegion(sheet([]), undefined, () => 0.9)).toEqual(cell(0));
  });

  it("is one whole variant, every variant reachable, never past the end", () => {
    const variants = [cell(1), cell(2), cell(3)];
    const seen = new Set<UVRegion>();
    for (const roll of [0, 0.2, 0.34, 0.5, 0.67, 0.99, 1]) {
      const region = pickTextureRegion(sheet(variants), undefined, () => roll);
      expect(variants).toContain(region);
      seen.add(region);
    }
    expect(seen.size).toBe(3);
  });

  it("follows the spawn's seeded source, so every client draws alike", () => {
    const variants = [cell(1), cell(2), cell(3)];
    const rolls = [0.1, 0.8, 0.4];
    const draw = () => {
      let i = 0;
      return rolls.map(() =>
        pickTextureRegion(sheet(variants), undefined, () => rolls[i++]),
      );
    };
    expect(draw()).toEqual(draw());
  });

  it("gives way to a region the spawn names itself", () => {
    const own = cell(2);
    expect(pickTextureRegion(sheet([cell(1)]), own, () => 0)).toBe(own);
  });
});
