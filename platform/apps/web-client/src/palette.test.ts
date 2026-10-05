import { describe, expect, it } from "vitest";

import { paletteMatches, windowTitle } from "./window-ui";

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

describe("window titles", () => {
  it("name the station a furnace-like window runs", () => {
    const f = { burnLeft: 0, burnTotal: 0, progress: 0, progressTotal: 0 };
    expect(windowTitle("furnace", { ...f, station: "crusher", name: "Crusher" })).toBe("Crusher");
    expect(windowTitle("furnace", f)).toBe("Furnace");
    expect(windowTitle("furnace", null)).toBe("Furnace");
    expect(windowTitle("chest", null)).toBe("Storage Chest");
  });
});
