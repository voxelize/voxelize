import { describe, expect, it } from "vitest";

import {
  ChunkRequestCandidate,
  compareChunkRequestPriority,
} from "./chunk-requests";

const candidate = (
  cx: number,
  cz: number,
  distanceSquared: number,
  isInView: boolean,
): ChunkRequestCandidate => ({ cx, cz, distanceSquared, isInView });

describe("compareChunkRequestPriority", () => {
  it("streams in-view chunks before out-of-view chunks regardless of distance", () => {
    const farInView = candidate(8, 0, 64, true);
    const nearOutOfView = candidate(-1, 0, 1, false);

    expect(compareChunkRequestPriority(farInView, nearOutOfView)).toBeLessThan(
      0,
    );
    expect(
      compareChunkRequestPriority(nearOutOfView, farInView),
    ).toBeGreaterThan(0);
  });

  it("orders chunks within the same view group by distance", () => {
    const near = candidate(1, 0, 1, true);
    const far = candidate(4, 0, 16, true);

    expect(compareChunkRequestPriority(near, far)).toBeLessThan(0);
    expect(compareChunkRequestPriority(far, near)).toBeGreaterThan(0);
  });

  it("keeps out-of-view chunks in the sorted result instead of dropping them", () => {
    const candidates = [
      candidate(-2, 0, 4, false),
      candidate(3, 0, 9, true),
      candidate(-1, 0, 1, false),
      candidate(1, 0, 1, true),
    ];

    const sorted = [...candidates].sort(compareChunkRequestPriority);

    expect(sorted.map(({ cx }) => cx)).toEqual([1, 3, -1, -2]);
    expect(sorted).toHaveLength(candidates.length);
  });
});
