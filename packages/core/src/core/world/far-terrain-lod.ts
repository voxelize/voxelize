/**
 * Which far-terrain tiles a viewer draws: a quadtree over the server's
 * levels. A tile splits into its four children while the viewer is within
 * `splitFactor` of its spans, so every level's cells subtend about the same
 * angle, and a tile tall with relief splits further so a mountain keeps its
 * shape at range. A tile whose children are not all built yet keeps
 * drawing itself, so the layer refines without ever opening a hole. Pure:
 * no three.js here.
 */

import type { FarTerrainDescriptor, FarTileKey } from "./far-terrain-tiles";
import { farTileId, farTileSpan } from "./far-terrain-tiles";

export type FarLodOptions = {
  /** A tile splits while the viewer is nearer than this many of its spans. */
  splitFactor: number;
  /**
   * A tile also splits while its relief (highest surface minus lowest)
   * exceeds this share of its span, down to `reliefMinLevel`.
   */
  reliefSplit: number;
  reliefMinLevel: number;
};

export const DEFAULT_FAR_LOD: FarLodOptions = {
  splitFactor: 2,
  reliefSplit: 0.6,
  reliefMinLevel: 1,
};

export type FarLodPlan = {
  /** Tiles to draw now, each covering its square once. */
  drawn: FarTileKey[];
  /** Tiles the detail rules want, nearest first. */
  wanted: FarTileKey[];
  /**
   * Coarser tiles worth fetching to stand in while their wanted
   * descendants load, coarsest first.
   */
  fallback: FarTileKey[];
};

type Square = { x0: number; z0: number; x1: number; z1: number };

const squareOf = (
  descriptor: FarTerrainDescriptor,
  key: FarTileKey,
): Square => {
  const span = farTileSpan(descriptor, key.level);
  const x0 = key.tx * span;
  const z0 = key.tz * span;
  return { x0, z0, x1: x0 + span, z1: z0 + span };
};

/** Distance from `(x, z)` to the nearest point of a tile's square. */
export function farTileDistance(
  descriptor: FarTerrainDescriptor,
  key: FarTileKey,
  x: number,
  z: number,
) {
  const { x0, z0, x1, z1 } = squareOf(descriptor, key);
  const dx = Math.max(0, x0 - x, x - x1);
  const dz = Math.max(0, z0 - z, z - z1);
  return Math.hypot(dx, dz);
}

export function farTileChildren(key: FarTileKey): FarTileKey[] {
  const level = key.level - 1;
  const tx = key.tx * 2;
  const tz = key.tz * 2;
  return [
    { level, tx, tz },
    { level, tx: tx + 1, tz },
    { level, tx, tz: tz + 1 },
    { level, tx: tx + 1, tz: tz + 1 },
  ];
}

/**
 * Plan a viewer's tiles out to `distance`. `isBuilt` says whether a tile's
 * mesh is ready to draw; `reliefOf` gives a resident tile's relief in
 * blocks, or null while it is unknown (an unknown relief never splits).
 */
export function planFarLod(
  descriptor: FarTerrainDescriptor,
  x: number,
  z: number,
  distance: number,
  options: FarLodOptions,
  isBuilt: (key: FarTileKey) => boolean,
  reliefOf: (key: FarTileKey) => number | null,
): FarLodPlan {
  const plan: FarLodPlan = { drawn: [], wanted: [], fallback: [] };
  if (distance <= 0 || descriptor.levels <= 0) return plan;
  const top = descriptor.levels - 1;
  const rootSpan = farTileSpan(descriptor, top);
  const wantedDistance = new Map<string, number>();

  const wantsSplit = (key: FarTileKey, near: number) => {
    if (key.level === 0) return false;
    const span = farTileSpan(descriptor, key.level);
    if (near < options.splitFactor * span) return true;
    if (key.level <= options.reliefMinLevel) return false;
    const relief = reliefOf(key);
    return relief !== null && relief > options.reliefSplit * span;
  };

  // Returns whether the square is drawn completely at its wanted detail
  // (or by a stand-in), appending what to draw.
  const visit = (key: FarTileKey, drawn: FarTileKey[]): boolean => {
    const near = farTileDistance(descriptor, key, x, z);
    if (near >= distance) return true;
    if (!wantsSplit(key, near)) {
      plan.wanted.push(key);
      wantedDistance.set(farTileId(key), near);
      if (!isBuilt(key)) return false;
      drawn.push(key);
      return true;
    }
    const below: FarTileKey[] = [];
    let complete = true;
    for (const child of farTileChildren(key)) {
      if (!visit(child, below)) complete = false;
    }
    if (complete) {
      drawn.push(...below);
      return true;
    }
    if (isBuilt(key)) {
      drawn.push(key);
      return true;
    }
    plan.fallback.push(key);
    drawn.push(...below);
    return false;
  };

  const tx0 = Math.floor((x - distance) / rootSpan);
  const tx1 = Math.floor((x + distance) / rootSpan);
  const tz0 = Math.floor((z - distance) / rootSpan);
  const tz1 = Math.floor((z + distance) / rootSpan);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let tz = tz0; tz <= tz1; tz++) {
      visit({ level: top, tx, tz }, plan.drawn);
    }
  }
  plan.wanted.sort(
    (a, b) =>
      (wantedDistance.get(farTileId(a)) ?? 0) -
      (wantedDistance.get(farTileId(b)) ?? 0),
  );
  plan.fallback.sort((a, b) => b.level - a.level);
  return plan;
}
