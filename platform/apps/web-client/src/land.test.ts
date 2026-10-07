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

import { borderPosts, chunkArea, claimRect, ringBox } from "./land";

describe("land sizes and borders", () => {
  it("grow and shrink claims by a ring of chunks", () => {
    expect(ringBox([0, 0], [1, 2], 1)).toEqual({ min: [-1, -1], max: [2, 3] });
    expect(ringBox([0, 0], [0, 0], -1)).toBeNull();
    expect(chunkArea([-1, -1], [2, 3])).toBe(20);
  });
  it("outline the border near the player", () => {
    expect(claimRect([0, 0], [0, 0])).toEqual([0, 0, 16, 16]);
    const posts = borderPosts([0, 0], [0, 0], 8, 8, 100);
    expect(posts.length).toBe(64);
    expect(posts).toContainEqual([16, 16]);
    expect(borderPosts([0, 0], [9, 9], 80, 80, 10)).toEqual([]);
  });
});
