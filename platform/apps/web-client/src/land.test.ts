import { describe, expect, it } from "vitest";

import { chunkOf, claimBox } from "./land";

describe("land helpers", () => {
  it("map blocks to 16-block land chunks, negative coordinates included", () => {
    expect(chunkOf(0, 0)).toEqual([0, 0]);
    expect(chunkOf(15.9, 31)).toEqual([0, 1]);
    expect(chunkOf(-0.1, -16)).toEqual([-1, -1]);
    expect(chunkOf(-16.5, 16)).toEqual([-2, 1]);
  });

  it("build claim boxes around a chunk", () => {
    expect(claimBox([3, -2], 0)).toEqual({ min: [3, -2], max: [3, -2] });
    expect(claimBox([3, -2], 1)).toEqual({ min: [2, -3], max: [4, -1] });
  });
});
