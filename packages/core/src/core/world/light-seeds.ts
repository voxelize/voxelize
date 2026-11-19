import type { Coords3 } from "../../types";

type SeedNode = { voxel: Coords3; level: number };

/** What one light job starts from. */
export type LightSeeds = {
  removals: Coords3[];
  floods: SeedNode[];
  pendingRemovals?: SeedNode[];
};

/**
 * A job's seeds as one list of integers, for the trip to a light worker: how
 * many removals, floods and pending removals, then each removal's voxel and
 * each node's voxel and level. A relight after a crater carries tens of
 * thousands of seeds, and posting them as objects made the page clone every
 * one on its main thread (tens of ms in a single frame); the list's buffer
 * is handed over instead, and the worker rebuilds the nodes on its own time.
 */
export function packLightSeeds(lightOps: LightSeeds): Int32Array {
  const { removals, floods } = lightOps;
  const pending = lightOps.pendingRemovals ?? [];
  const packed = new Int32Array(
    3 + removals.length * 3 + (floods.length + pending.length) * 4,
  );
  packed[0] = removals.length;
  packed[1] = floods.length;
  packed[2] = pending.length;
  let at = 3;
  for (let i = 0; i < removals.length; i += 1) {
    const voxel = removals[i];
    packed[at++] = voxel[0];
    packed[at++] = voxel[1];
    packed[at++] = voxel[2];
  }
  for (const nodes of [floods, pending]) {
    for (let i = 0; i < nodes.length; i += 1) {
      const { voxel, level } = nodes[i];
      packed[at++] = voxel[0];
      packed[at++] = voxel[1];
      packed[at++] = voxel[2];
      packed[at++] = level;
    }
  }
  return packed;
}

/** The seeds {@link packLightSeeds} packed, as a job holds them. */
export function unpackLightSeeds(packed: Int32Array): LightSeeds {
  const removals: Coords3[] = new Array(packed[0]);
  const floods: SeedNode[] = new Array(packed[1]);
  const pending: SeedNode[] = new Array(packed[2]);
  let at = 3;
  for (let i = 0; i < removals.length; i += 1) {
    removals[i] = [packed[at], packed[at + 1], packed[at + 2]];
    at += 3;
  }
  for (const nodes of [floods, pending]) {
    for (let i = 0; i < nodes.length; i += 1) {
      nodes[i] = {
        voxel: [packed[at], packed[at + 1], packed[at + 2]],
        level: packed[at + 3],
      };
      at += 4;
    }
  }
  return pending.length > 0
    ? { removals, floods, pendingRemovals: pending }
    : { removals, floods };
}
