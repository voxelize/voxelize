import { describe, expect, it } from "vitest";

import { BoundedLruMap } from "./bounded-lru-map";

describe("BoundedLruMap", () => {
  it("evicts the least-recently-used entry once full", () => {
    const map = new BoundedLruMap<string, number>(3);

    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.set("d", 4);

    expect(map.size).toBe(3);
    expect(map.has("a")).toBe(false);
    expect([...map.values()]).toEqual([2, 3, 4]);
  });

  it("counts a read as a use", () => {
    const map = new BoundedLruMap<string, number>(2);

    map.set("a", 1);
    map.set("b", 2);
    expect(map.get("a")).toBe(1);
    map.set("c", 3);

    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
  });

  it("does not reorder on peek", () => {
    const map = new BoundedLruMap<string, number>(2);

    map.set("a", 1);
    map.set("b", 2);
    expect(map.peek("a")).toBe(1);
    map.set("c", 3);

    expect(map.has("a")).toBe(false);
  });

  it("refreshes an entry that is written again instead of duplicating it", () => {
    const map = new BoundedLruMap<string, number>(2);

    map.set("a", 1);
    map.set("b", 2);
    map.set("a", 10);
    map.set("c", 3);

    expect(map.size).toBe(2);
    expect(map.get("a")).toBe(10);
    expect(map.has("b")).toBe(false);
  });

  it("stays empty when capacity is below one", () => {
    const map = new BoundedLruMap<string, number>(0);

    map.set("a", 1);

    expect(map.size).toBe(0);
    expect(map.get("a")).toBeUndefined();
  });

  it("holds a bounded number of entries under an unbounded key space", () => {
    const map = new BoundedLruMap<string, number>(64);

    for (let i = 0; i < 100_000; i++) {
      map.set(`voxel-${i}`, i);
    }

    expect(map.size).toBe(64);
    expect(map.get("voxel-99999")).toBe(99999);
    expect(map.get("voxel-0")).toBeUndefined();
  });

  it("supports explicit removal and clearing", () => {
    const map = new BoundedLruMap<string, number>(4);

    map.set("a", 1);
    map.set("b", 2);

    expect(map.delete("a")).toBe(true);
    expect(map.delete("a")).toBe(false);
    expect(map.size).toBe(1);

    map.clear();
    expect(map.size).toBe(0);
  });
});
