import { describe, expect, it } from "vitest";
import { Content, MobDef } from "./content";
import { MobInfo, nearestBoss } from "./mobs-view";

const def = (key: string, health: number, boss = false): MobDef => ({
  key,
  name: key === "warden" ? "Ember Warden" : key,
  kind: "hostile",
  health,
  size: [1, 2],
  boss,
  model: [],
});
const content = new Content({ blocks: [], items: [], recipes: [], mobs: [def("warden", 200, true), def("shambler", 20)] });
const mob = (id: number, key: string, p: [number, number, number], health: number): MobInfo => ({
  id,
  key,
  p,
  yaw: 0,
  health,
  hurt: false,
  baby: false,
  moving: false,
  love: false,
});

describe("boss bar", () => {
  it("shows the nearest boss in range with its remaining health", () => {
    const bar = nearestBoss([mob(1, "shambler", [1, 0, 0], 5), mob(2, "warden", [10, 0, 0], 50)], content, [0, 0, 0]);
    expect(bar).toEqual({ name: "Ember Warden", fraction: 0.25 });
  });
  it("hides when no boss is near", () => {
    expect(nearestBoss([mob(2, "warden", [100, 0, 0], 200)], content, [0, 0, 0])).toBeNull();
    expect(nearestBoss([mob(1, "shambler", [1, 0, 0], 5)], content, [0, 0, 0])).toBeNull();
  });
});
