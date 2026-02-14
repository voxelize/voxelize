import { describe, expect, it } from "vitest";

import { ChunkUtils } from "../src/utils/chunk-utils";

describe("ChunkUtils.mapVoxelToChunkAt", () => {
  it("matches floor division for power-of-two chunk sizes", () => {
    const samples: Array<[number, number]> = [
      [-33, -17],
      [-16, -1],
      [-1, -16],
      [0, 0],
      [1, 15],
      [16, 16],
      [33, 47],
    ];
    for (let index = 0; index < samples.length; index++) {
      const [vx, vz] = samples[index];
      const [cx, cz] = ChunkUtils.mapVoxelToChunkAt(vx, vz, 16);
      expect(cx).toBe(Math.floor(vx / 16));
      expect(cz).toBe(Math.floor(vz / 16));
    }
  });

  it("falls back to floored voxel coords for invalid chunk sizes", () => {
    expect(ChunkUtils.mapVoxelToChunkAt(3.7, -8.2, 0)).toEqual([3, -9]);
    expect(ChunkUtils.mapVoxelToChunkAt(3.7, -8.2, Number.NaN)).toEqual([3, -9]);
    expect(ChunkUtils.mapVoxelToChunkAt(3.7, -8.2, Number.POSITIVE_INFINITY)).toEqual([3, -9]);
  });
});

describe("ChunkUtils.mapVoxelToChunkLocal", () => {
  it("keeps invalid chunk sizes from producing NaN local coords", () => {
    expect(ChunkUtils.mapVoxelToChunkLocal([3, 5, -8], 0)).toEqual([0, 5, 0]);
    expect(ChunkUtils.mapVoxelToChunkLocal([3, 5, -8], Number.NaN)).toEqual([0, 5, 0]);
    expect(ChunkUtils.mapVoxelToChunkLocal([3, 5, -8], Number.POSITIVE_INFINITY)).toEqual([0, 5, 0]);
  });
});

describe("ChunkUtils.parseChunkNameAt", () => {
  it("keeps compatibility with extra separator segments", () => {
    expect(ChunkUtils.parseChunkNameAt("1|2|3")).toEqual([1, 2]);
  });

  it("returns NaN for missing separator", () => {
    const [cx, cz] = ChunkUtils.parseChunkNameAt("123");
    expect(cx).toBe(123);
    expect(Number.isNaN(cz)).toBe(true);
  });
});
