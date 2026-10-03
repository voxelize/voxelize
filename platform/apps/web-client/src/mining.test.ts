import { describe, expect, it } from "vitest";

import { BlockDef, canHarvest, ItemDef, miningMillis } from "./content";

// Same expectations as crates/content (mining_needs_the_right_tool_to_harvest):
// the client's progress bar must agree with the server's rule.
const stone: BlockDef = {
  id: 2,
  key: "stone",
  name: "Stone",
  hardness: 1.5,
  texture: { all: "stone" },
  tool: { kind: "pickaxe" },
};
const dirt: BlockDef = {
  id: 4,
  key: "dirt",
  name: "Dirt",
  hardness: 0.5,
  texture: { all: "dirt" },
  tool: { kind: "shovel", required: false },
};
const woodenPickaxe: ItemDef = {
  id: 24,
  key: "wooden_pickaxe",
  name: "Wooden Pickaxe",
  type: "tool",
  stackSize: 1,
  tool: { kind: "pickaxe", tier: 0, speed: 2 },
};

describe("mining rule parity with the server", () => {
  it("bare hands on stone take 7.5 s and harvest nothing", () => {
    expect(miningMillis(stone, undefined)).toBe(7500);
    expect(canHarvest(stone, undefined)).toBe(false);
  });

  it("a wooden pickaxe takes 1.125 s and harvests", () => {
    expect(miningMillis(stone, woodenPickaxe)).toBe(1125);
    expect(canHarvest(stone, woodenPickaxe)).toBe(true);
  });

  it("soil drops by hand", () => {
    expect(canHarvest(dirt, undefined)).toBe(true);
    expect(miningMillis(dirt, undefined)).toBe(750);
  });

  it("unbreakable blocks have no time", () => {
    expect(miningMillis({ ...stone, hardness: -1 }, woodenPickaxe)).toBeNull();
  });
});
