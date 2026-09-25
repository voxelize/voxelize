import type { BlockRotation } from "./block";
import type { RawChunk } from "./raw-chunk";

export type VoxelDelta = {
  coords: [number, number, number];
  oldVoxel: number;
  newVoxel: number;
  oldRotation?: BlockRotation;
  newRotation?: BlockRotation;
  oldStage?: number;
  newStage?: number;
  /**
   * The whole packed word after the change: id, rotation, stage and
   * waterlogging. The per-field values above describe what changed; this
   * is what a copy of the chunk must hold afterwards.
   */
  newRaw: number;
  timestamp: number;
  sequenceId: number;
};

/**
 * Replay a main-thread voxel change on a worker's copy of the chunk. The
 * whole word is written, so a change to one field (a stage, a rotation)
 * never rewrites the others: rebuilding the word from `newVoxel` alone
 * reads a stage-only change as air, since its `newVoxel` is not the id.
 */
export function applyVoxelDelta(chunk: RawChunk, delta: VoxelDelta) {
  const [vx, vy, vz] = delta.coords;
  chunk.setRawValue(vx, vy, vz, delta.newRaw);
}
