import { describe, expect, it } from "vitest";

import { VoxelHistory } from "./voxel-history";

describe("VoxelHistory", () => {
  it("answers what a voxel held before its latest changes", () => {
    const history = new VoxelHistory(8, 3);
    history.record("1|2|3", 5);
    history.record("1|2|3", 6);
    expect(history.previous("1|2|3")).toBe(6);
    expect(history.previous("1|2|3", 2)).toBe(5);
    expect(history.previous("1|2|3", 3)).toBe(0);
    expect(history.previous("9|9|9")).toBe(0);
  });

  it("keeps only the newest values of one voxel", () => {
    const history = new VoxelHistory(8, 2);
    for (const value of [1, 2, 3, 4]) history.record("0|0|0", value);
    expect(history.previous("0|0|0", 1)).toBe(4);
    expect(history.previous("0|0|0", 2)).toBe(3);
    expect(history.previous("0|0|0", 3)).toBe(0);
  });

  it("makes room by dropping the voxel first recorded longest ago", () => {
    const history = new VoxelHistory(3, 4);
    history.record("a", 1);
    history.record("b", 2);
    history.record("c", 3);
    history.record("a", 11);
    history.record("d", 4);
    expect(history.size).toBe(3);
    expect(history.previous("a")).toBe(0);
    expect(history.previous("b")).toBe(2);
    expect(history.previous("d")).toBe(4);
    history.record("a", 12);
    expect(history.previous("a")).toBe(12);
    expect(history.previous("b")).toBe(0);
  });

  it("never holds more voxels than its capacity through a mass edit", () => {
    const history = new VoxelHistory(64, 4);
    for (let i = 0; i < 10_000; i += 1) history.record(`${i}|0|0`, i);
    expect(history.size).toBe(64);
    expect(history.previous("9999|0|0")).toBe(9999);
    expect(history.previous("9935|0|0")).toBe(0);
    expect(history.previous("9936|0|0")).toBe(9936);
  });

  it("keeps nothing with no capacity or no depth", () => {
    const none = new VoxelHistory(0, 4);
    none.record("a", 1);
    expect(none.size).toBe(0);
    const shallow = new VoxelHistory(4, 0);
    shallow.record("a", 1);
    expect(shallow.previous("a")).toBe(0);
  });

  it("forgets everything on clear and fills again", () => {
    const history = new VoxelHistory(2, 4);
    history.record("a", 1);
    history.record("b", 2);
    history.clear();
    expect(history.size).toBe(0);
    history.record("c", 3);
    history.record("d", 4);
    history.record("e", 5);
    expect(history.size).toBe(2);
    expect(history.previous("c")).toBe(0);
    expect(history.previous("e")).toBe(5);
  });
});
