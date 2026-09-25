import ndarray from "ndarray";
import { describe, expect, it } from "vitest";

import { BlockUtils } from "../../utils/block-utils";

import { BlockRotation, PX_ROTATION } from "./block";
import { RawChunk } from "./raw-chunk";
import { applyVoxelDelta, type VoxelDelta } from "./voxel-delta";

const options = { size: 4, maxHeight: 4, maxLightLevel: 15, subChunks: 1 };
const STONE = 7;

function chunkWith(raw: number) {
  const chunk = new RawChunk("0|0", [0, 0], options);
  const { size, maxHeight } = options;
  chunk.voxels = ndarray(new Uint32Array(size * maxHeight * size), [
    size,
    maxHeight,
    size,
  ]);
  chunk.setRawValue(1, 2, 1, raw);
  return chunk;
}

function delta(fields: Partial<VoxelDelta> & { newRaw: number }): VoxelDelta {
  return {
    coords: [1, 2, 1],
    oldVoxel: 0,
    newVoxel: 0,
    timestamp: 0,
    sequenceId: 0,
    ...fields,
  };
}

describe("applyVoxelDelta", () => {
  const rotated = BlockRotation.encode(PX_ROTATION, 2);
  const before = BlockUtils.insertAll(STONE, rotated, 5);

  it("keeps the block when only its stage changes", () => {
    const chunk = chunkWith(before);
    const after = BlockUtils.insertStage(before, 9);
    applyVoxelDelta(chunk, delta({ oldStage: 5, newStage: 9, newRaw: after }));
    expect(chunk.getVoxel(1, 2, 1)).toBe(STONE);
    expect(chunk.getVoxelStage(1, 2, 1)).toBe(9);
    expect(chunk.getVoxelRotation(1, 2, 1).value).toBe(PX_ROTATION);
  });

  it("carries a stage back to zero without dropping the block", () => {
    const chunk = chunkWith(before);
    const after = BlockUtils.insertStage(before, 0);
    applyVoxelDelta(chunk, delta({ oldStage: 5, newStage: 0, newRaw: after }));
    expect(chunk.getRawValue(1, 2, 1)).toBe(after);
    expect(chunk.getVoxel(1, 2, 1)).toBe(STONE);
  });

  it("replays a run of partial deltas to the last word", () => {
    const chunk = chunkWith(0);
    const placed = BlockUtils.insertID(0, STONE);
    const staged = BlockUtils.insertStage(placed, 3);
    const turned = BlockUtils.insertRotation(staged, rotated);
    for (const d of [
      delta({ newVoxel: STONE, newRaw: placed }),
      delta({ newStage: 3, newRaw: staged }),
      delta({ newRotation: rotated, newRaw: turned }),
    ]) {
      applyVoxelDelta(chunk, d);
    }
    expect(chunk.getRawValue(1, 2, 1)).toBe(turned);
  });
});
