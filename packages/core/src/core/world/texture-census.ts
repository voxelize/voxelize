/**
 * What every rendered surface is wearing, and the ledger behind the answer.
 *
 * Every block surface starts life on the magenta-and-black unknown checker
 * and is painted later: atlas slots by their texture group, own-texture
 * faces by their group or a direct texture call, a voxel's isolated face by
 * its block entity. A surface still on the checker once play begins is a
 * defect — a missing texture, a lost paint — and the checker is loud so
 * nobody misses it. The census makes the same fact available as data, so a
 * harness can assert "nothing unpainted" instead of a human squinting at a
 * screenshot, and the fallback fill can make a stage presentable while the
 * real texture is on its way, without hiding that it was needed.
 */

import type { Coords3 } from "../../types";

export type SurfaceKind = "atlas-slot" | "own-face" | "isolated-face";

/**
 * - `unknown`: the checker.
 * - `default`: an isolated face wearing its face's default art while it
 *   waits for the voxel's own paint (blank paper, an empty frame).
 * - `fallback`: painted by {@link World.fillUnpaintedSurfaces}, not by its
 *   own texture.
 * - `painted`: its own art.
 */
export type SurfaceState = "unknown" | "default" | "fallback" | "painted";

export type UnpaintedSurface = {
  kind: SurfaceKind;
  state: Exclude<SurfaceState, "painted">;
  blockId: number;
  blockName: string;
  faceName: string;
  textureGroup: string | null;
  /** Isolated faces only: the voxel whose face this is. */
  voxel?: Coords3;
  /** Isolated faces only: how long the material has existed. */
  ageMs?: number;
};

export type SurfaceTally = {
  total: number;
  painted: number;
  default: number;
  fallback: number;
  unknown: number;
};

export type TextureCensus = {
  atlasSlots: SurfaceTally;
  ownFaces: SurfaceTally;
  isolatedFaces: SurfaceTally;
  /** Every surface not wearing its own art, worst first. */
  unpainted: UnpaintedSurface[];
};

export type TextureFillResult = {
  color: string;
  filled: { atlasSlots: number; ownFaces: number; isolatedFaces: number };
};

export function emptyTally(): SurfaceTally {
  return { total: 0, painted: 0, default: 0, fallback: 0, unknown: 0 };
}

export function tallyState(tally: SurfaceTally, state: SurfaceState) {
  tally.total += 1;
  tally[state] += 1;
}

/** Worst first: the checker, then fallbacks, then defaults still waiting. */
const STATE_SEVERITY: Record<Exclude<SurfaceState, "painted">, number> = {
  unknown: 0,
  fallback: 1,
  default: 2,
};

export function sortUnpainted(surfaces: UnpaintedSurface[]) {
  return surfaces.sort(
    (a, b) =>
      STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] ||
      a.blockName.localeCompare(b.blockName) ||
      a.faceName.localeCompare(b.faceName),
  );
}

export type IsolatedFaceEntry<TMaterial> = {
  blockId: number;
  faceName: string;
  voxel: Coords3;
  material: TMaterial;
  state: SurfaceState;
  createdAt: number;
};

/**
 * Every per-voxel isolated-face material the world has made, with what it
 * is wearing. The world consults it to answer the census, to hand a face
 * its default the moment that default is painted (a chunk can mesh before
 * the registry's textures land), and to fill what is still unknown.
 */
export class IsolatedFaceLedger<TMaterial> {
  private byKey = new Map<string, IsolatedFaceEntry<TMaterial>>();
  private keysByFace = new Map<string, Set<string>>();

  private static faceKey(blockId: number, faceName: string) {
    return `${blockId}::${faceName}`;
  }

  get size() {
    return this.byKey.size;
  }

  get(key: string) {
    return this.byKey.get(key);
  }

  /**
   * Record a material's current dress. A material seen for the first time
   * is registered; one already known only changes state, so a paint after
   * a seed reads `painted` and a seed after a paint never demotes it.
   */
  note(
    key: string,
    entry: Omit<IsolatedFaceEntry<TMaterial>, "state" | "createdAt">,
    state: SurfaceState,
    now: number,
  ): IsolatedFaceEntry<TMaterial> {
    let stored = this.byKey.get(key);
    if (!stored) {
      stored = { ...entry, state, createdAt: now };
      this.byKey.set(key, stored);
      const faceKey = IsolatedFaceLedger.faceKey(entry.blockId, entry.faceName);
      let keys = this.keysByFace.get(faceKey);
      if (!keys) {
        keys = new Set();
        this.keysByFace.set(faceKey, keys);
      }
      keys.add(key);
      return stored;
    }
    stored.material = entry.material;
    if (state === "painted" || stored.state !== "painted") {
      stored.state = state;
    }
    return stored;
  }

  remove(key: string) {
    const entry = this.byKey.get(key);
    if (!entry) return false;
    this.byKey.delete(key);
    const faceKey = IsolatedFaceLedger.faceKey(entry.blockId, entry.faceName);
    const keys = this.keysByFace.get(faceKey);
    keys?.delete(key);
    if (keys && keys.size === 0) this.keysByFace.delete(faceKey);
    return true;
  }

  /** The entries for one block face in a given state. */
  entriesForFace(
    blockId: number,
    faceName: string,
    state?: SurfaceState,
  ): Array<{ key: string; entry: IsolatedFaceEntry<TMaterial> }> {
    const keys = this.keysByFace.get(
      IsolatedFaceLedger.faceKey(blockId, faceName),
    );
    if (!keys) return [];
    const out: Array<{ key: string; entry: IsolatedFaceEntry<TMaterial> }> = [];
    for (const key of keys) {
      const entry = this.byKey.get(key);
      if (!entry) continue;
      if (state && entry.state !== state) continue;
      out.push({ key, entry });
    }
    return out;
  }

  entries(): Array<{ key: string; entry: IsolatedFaceEntry<TMaterial> }> {
    return [...this.byKey.entries()].map(([key, entry]) => ({ key, entry }));
  }

  clear() {
    this.byKey.clear();
    this.keysByFace.clear();
  }
}
