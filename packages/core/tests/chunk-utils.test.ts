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

  it("keeps floor-division semantics for fractional voxel coordinates", () => {
    expect(ChunkUtils.mapVoxelToChunkAt(-0.5, 15.9, 16)).toEqual([
      Math.floor(-0.5 / 16),
      Math.floor(15.9 / 16),
    ]);
  });

  it("falls back to floor division for coordinates outside int32 range", () => {
    const vx = 2147483648;
    const vz = -2147483649;
    expect(ChunkUtils.mapVoxelToChunkAt(vx, vz, 16)).toEqual([
      Math.floor(vx / 16),
      Math.floor(vz / 16),
    ]);
  });

  it("falls back to floored voxel coords for invalid chunk sizes", () => {
    expect(ChunkUtils.mapVoxelToChunkAt(3.7, -8.2, 0)).toEqual([3, -9]);
    expect(ChunkUtils.mapVoxelToChunkAt(3.7, -8.2, Number.NaN)).toEqual([3, -9]);
    expect(ChunkUtils.mapVoxelToChunkAt(3.7, -8.2, Number.POSITIVE_INFINITY)).toEqual([3, -9]);
  });

  it("normalizes fractional chunk sizes to positive integer divisors", () => {
    expect(ChunkUtils.mapVoxelToChunkAt(31, -1, 15.8)).toEqual([2, -1]);
  });

  it("clamps oversized chunk sizes to i32 max for stable mapping semantics", () => {
    const largeChunkSize = Number.MAX_SAFE_INTEGER;
    const vx = 4294967294;
    expect(ChunkUtils.mapVoxelToChunkAt(vx, 0, largeChunkSize)).toEqual([
      Math.floor(vx / 2147483647),
      0,
    ]);
  });
});

describe("ChunkUtils.mapVoxelToChunkLocal", () => {
  it("keeps euclidean remainder semantics for power-of-two chunk sizes", () => {
    expect(ChunkUtils.mapVoxelToChunkLocal([-1, 7, -17], 16)).toEqual([15, 7, 15]);
  });

  it("keeps mixed int/fractional semantics for power-of-two chunk sizes", () => {
    expect(ChunkUtils.mapVoxelToChunkLocal([-1, 7, -16.25], 16)).toEqual([
      15,
      7,
      15.75,
    ]);
  });

  it("keeps floor-division semantics for fractional local coordinates", () => {
    expect(ChunkUtils.mapVoxelToChunkLocal([-0.5, 7, -16.25], 16)).toEqual([
      15.5,
      7,
      15.75,
    ]);
  });

  it("keeps invalid chunk sizes from producing NaN local coords", () => {
    expect(ChunkUtils.mapVoxelToChunkLocal([3, 5, -8], 0)).toEqual([0, 5, 0]);
    expect(ChunkUtils.mapVoxelToChunkLocal([3, 5, -8], Number.NaN)).toEqual([0, 5, 0]);
    expect(ChunkUtils.mapVoxelToChunkLocal([3, 5, -8], Number.POSITIVE_INFINITY)).toEqual([0, 5, 0]);
  });
});

describe("ChunkUtils.getChunkNameByVoxel", () => {
  it("uses the same chunk mapping semantics as mapVoxelToChunkAt", () => {
    const [cx, cz] = ChunkUtils.mapVoxelToChunkAt(33, -1, 16);
    expect(ChunkUtils.getChunkNameByVoxel(33, -1, 16)).toBe(
      ChunkUtils.getChunkNameAt(cx, cz)
    );
  });

  it("keeps mixed integer and fractional axis semantics for power-of-two chunk sizes", () => {
    const vx = 31;
    const vz = -16.25;
    const [cx, cz] = ChunkUtils.mapVoxelToChunkAt(vx, vz, 16);
    expect(ChunkUtils.getChunkNameByVoxel(vx, vz, 16)).toBe(
      ChunkUtils.getChunkNameAt(cx, cz)
    );
  });

  it("handles invalid chunk sizes with normalized fallback", () => {
    expect(ChunkUtils.getChunkNameByVoxel(3.7, -8.2, 0)).toBe("3|-9");
    expect(ChunkUtils.getChunkNameByVoxel(3.7, -8.2, Number.NaN)).toBe("3|-9");
  });

  it("normalizes fractional chunk sizes consistently", () => {
    expect(ChunkUtils.getChunkNameByVoxel(31, -1, 15.8)).toBe("2|-1");
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

  it("handles empty separator without degenerate indexOf behavior", () => {
    const [cx, cz] = ChunkUtils.parseChunkNameAt("123", "");
    expect(cx).toBe(123);
    expect(Number.isNaN(cz)).toBe(true);
  });

  it("parses signed values with leading ASCII whitespace", () => {
    expect(ChunkUtils.parseChunkNameAt("  +12| -3")).toEqual([12, -3]);
  });

  it("supports multi-character separators while preserving first two segments", () => {
    expect(ChunkUtils.parseChunkNameAt("10::20::30", "::")).toEqual([10, 20]);
  });

  it("saturates oversized numeric segments to safe integer bounds", () => {
    const [positiveX] = ChunkUtils.parseChunkNameAt("999999999999999999999999|1");
    const [negativeX] = ChunkUtils.parseChunkNameAt("-999999999999999999999999|1");
    expect(positiveX).toBe(Number.MAX_SAFE_INTEGER);
    expect(negativeX).toBe(-Number.MAX_SAFE_INTEGER);
  });
});

describe("ChunkUtils.mapChunkToVoxel", () => {
  it("uses normalized chunk sizes for invalid and fractional inputs", () => {
    expect(ChunkUtils.mapChunkToVoxel([3, -2], 0)).toEqual([3, 0, -2]);
    expect(ChunkUtils.mapChunkToVoxel([3, -2], 15.8)).toEqual([45, 0, -30]);
  });

  it("clamps oversized chunk sizes to i32 max", () => {
    expect(ChunkUtils.mapChunkToVoxel([2, -1], Number.MAX_SAFE_INTEGER)).toEqual([
      2 * 2147483647,
      0,
      -2147483647,
    ]);
  });
});
