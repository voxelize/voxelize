import { describe, expect, it } from "vitest";

import {
  DEFAULT_FAR_LOD,
  farTileChildren,
  farTileDistance,
  planFarLod,
} from "./far-terrain-lod";
import {
  FarTerrainDescriptor,
  farTileId,
  FarTileKey,
} from "./far-terrain-tiles";

// Steps 2, 4, 8, 16: spans 64, 128, 256, 512.
const descriptor: FarTerrainDescriptor = {
  baseStep: 2,
  tileSamples: 33,
  levels: 4,
  waterSurface: 86.875,
};

const everything = () => true;
const noRelief = () => null;

const covers = (outer: FarTileKey, inner: FarTileKey) => {
  if (inner.level >= outer.level) return false;
  const shift = outer.level - inner.level;
  return (
    Math.floor(inner.tx / 2 ** shift) === outer.tx &&
    Math.floor(inner.tz / 2 ** shift) === outer.tz
  );
};

describe("planFarLod", () => {
  it("gives every level's cells about the same angle: finest near, coarsest far", () => {
    const plan = planFarLod(
      descriptor,
      0,
      0,
      1024,
      DEFAULT_FAR_LOD,
      everything,
      noRelief,
    );
    expect(plan.fallback).toHaveLength(0);
    for (const key of plan.drawn) {
      const near = farTileDistance(descriptor, key, 0, 0);
      expect(near).toBeLessThan(1024);
      // A tile at level L is drawn only where its parent was close enough
      // to split, and itself far enough not to.
      const span =
        (descriptor.tileSamples - 1) * (descriptor.baseStep << key.level);
      if (key.level > 0) expect(near).toBeGreaterThanOrEqual(2 * span);
    }
    const levels = new Set(plan.drawn.map((key) => key.level));
    expect(levels).toEqual(new Set([0, 1, 2]));
  });

  it("draws each square once: never a tile and its ancestor", () => {
    const plan = planFarLod(
      descriptor,
      37,
      -91,
      1024,
      DEFAULT_FAR_LOD,
      everything,
      noRelief,
    );
    for (const a of plan.drawn) {
      for (const b of plan.drawn) {
        if (a !== b) expect(covers(a, b)).toBe(false);
      }
    }
    const ids = plan.drawn.map(farTileId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a coarse tile standing until all its children are built", () => {
    const parent = { level: 1, tx: 1, tz: 0 };
    const children = farTileChildren(parent).map(farTileId);
    const missing = children[2];
    const isBuilt = (key: FarTileKey) => farTileId(key) !== missing;
    const plan = planFarLod(
      descriptor,
      140,
      20,
      1024,
      DEFAULT_FAR_LOD,
      isBuilt,
      noRelief,
    );
    const drawn = plan.drawn.map(farTileId);
    expect(drawn).toContain(farTileId(parent));
    for (const child of children) expect(drawn).not.toContain(child);
    expect(plan.wanted.map(farTileId)).toContain(missing);
  });

  it("asks for coarse stand-ins first when nothing is built yet", () => {
    const plan = planFarLod(
      descriptor,
      0,
      0,
      1024,
      DEFAULT_FAR_LOD,
      () => false,
      noRelief,
    );
    expect(plan.drawn).toHaveLength(0);
    expect(plan.fallback.length).toBeGreaterThan(0);
    expect(plan.fallback[0].level).toBe(descriptor.levels - 1);
    // Wanted tiles come nearest first.
    const distances = plan.wanted.map((key) =>
      farTileDistance(descriptor, key, 0, 0),
    );
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("splits a tall tile further so a mountain keeps its shape at range", () => {
    const far = { x: 0, z: 0 };
    const mountain = { level: 2, tx: 3, tz: 0 };
    const flat = planFarLod(
      descriptor,
      far.x,
      far.z,
      1200,
      DEFAULT_FAR_LOD,
      everything,
      noRelief,
    );
    expect(flat.drawn.map(farTileId)).toContain(farTileId(mountain));
    const tall = planFarLod(
      descriptor,
      far.x,
      far.z,
      1200,
      DEFAULT_FAR_LOD,
      everything,
      (key) => (farTileId(key) === farTileId(mountain) ? 220 : 10),
    );
    const drawn = tall.drawn.map(farTileId);
    expect(drawn).not.toContain(farTileId(mountain));
    for (const child of farTileChildren(mountain)) {
      expect(drawn).toContain(farTileId(child));
    }
  });

  it("draws nothing when the layer is off", () => {
    const plan = planFarLod(
      descriptor,
      0,
      0,
      0,
      DEFAULT_FAR_LOD,
      everything,
      noRelief,
    );
    expect(plan.drawn).toHaveLength(0);
    expect(plan.wanted).toHaveLength(0);
  });
});
