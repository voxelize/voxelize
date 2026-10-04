import { describe, expect, it } from "vitest";

import { paletteMatches } from "./window-ui";

describe("creative palette search", () => {
  const items = [
    { key: "oak_log", name: "Oak Log" },
    { key: "iron_ingot", name: "Iron Ingot" },
    { key: "fire_striker", name: "Fire Striker" },
  ];
  it("matches names and keys, case-insensitively", () => {
    expect(paletteMatches(items, "")).toHaveLength(3);
    expect(paletteMatches(items, "iron").map((i) => i.key)).toEqual(["iron_ingot"]);
    expect(paletteMatches(items, " OAK ").map((i) => i.key)).toEqual(["oak_log"]);
    expect(paletteMatches(items, "_striker").map((i) => i.key)).toEqual(["fire_striker"]);
    expect(paletteMatches(items, "zzz")).toEqual([]);
  });
});
