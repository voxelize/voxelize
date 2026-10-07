import { describe, expect, it } from "vitest";
import { ARMOR_SHAPES, armorColor } from "./hud";

describe("armor icons", () => {
  it("colour each set and draw every slot", () => {
    expect(armorColor("iron_helmet")).toBe("#c9ccd2");
    expect(armorColor("ember_boots")).toBe("#e2783a");
    expect(Object.keys(ARMOR_SHAPES).sort()).toEqual(["chest", "feet", "head", "legs"]);
    for (const boxes of Object.values(ARMOR_SHAPES)) for (const [x, y, w, h] of boxes) expect(x + w <= 32 && y + h <= 32).toBe(true);
  });
});
