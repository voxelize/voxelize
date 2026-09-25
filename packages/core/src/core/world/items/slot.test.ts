import { describe, expect, it } from "vitest";

import { blockSlot, isSamePeerSlotData, itemSlot, peerSlotData } from "./slot";

describe("peer slot data", () => {
  it("shows only the keys a game names, and nothing when it has none", () => {
    const slot = itemSlot(9, 1, { color: 3, durability: 40 });
    expect(peerSlotData(slot, ["color", "variant"])).toEqual({ color: 3 });
    expect(peerSlotData(slot, ["variant"])).toBeNull();
    expect(peerSlotData(itemSlot(9, 1), ["color"])).toBeNull();
    expect(peerSlotData(blockSlot(1, 1), ["color"])).toBeNull();
  });

  it("compares what peers would see", () => {
    expect(isSamePeerSlotData({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
    expect(isSamePeerSlotData({ a: 1 }, { a: 2 })).toBe(false);
    expect(isSamePeerSlotData(null, undefined)).toBe(true);
    expect(isSamePeerSlotData(null, { a: 1 })).toBe(false);
  });
});
