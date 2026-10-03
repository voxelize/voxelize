import { describe, expect, it } from "vitest";

import { RecipeDef } from "./content";
import { recipeFits } from "./recipes";

describe("recipe grid fit", () => {
  it("2x2 recipes fit both grids, 3x3 only the workbench", () => {
    const sticks: RecipeDef = { type: "shaped", key: "stick", pattern: ["#", "#"], symbols: { "#": "planks" }, result: { item: "stick" } };
    const pick: RecipeDef = { type: "shaped", key: "p", pattern: ["###", " s ", " s "], symbols: { "#": "planks", s: "stick" }, result: { item: "p" } };
    expect(recipeFits(sticks, 2)).toBe(true);
    expect(recipeFits(pick, 2)).toBe(false);
    expect(recipeFits(pick, 3)).toBe(true);
    expect(recipeFits({ type: "shapeless", key: "x", ingredients: ["a", "b", "c", "d", "e"], result: { item: "x" } }, 2)).toBe(false);
  });
});
