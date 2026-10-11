import { describe, expect, it } from "vitest";

import { blessingLine, LEVELS, levelProgress, peerLabel, todayLine, virtueLine, type VirtueState } from "./virtue";

const state = (over: Partial<VirtueState> = {}): VirtueState => ({
  points: 345,
  level: 2,
  title: "Gardener",
  toNext: 255,
  builtToday: 120,
  helpedToday: 30,
  buildCap: 300,
  helpCap: 300,
  divine: false,
  ...over,
});

describe("virtue", () => {
  it("puts titles on name tags only in Paradise, and makes Saints glow", () => {
    const tag = { id: "a", level: 2, title: "Gardener", glow: false };
    expect(peerLabel("ana", tag, true)).toBe("ana · Gardener");
    expect(peerLabel("ana", tag, false)).toBe("ana");
    expect(peerLabel("ana", { ...tag, level: 0, title: "Pilgrim" }, true)).toBe("ana");
    expect(peerLabel("ana", { id: "a", level: 5, title: "Saint", glow: true }, true)).toBe("✦ ana · Saint ✦");
    expect(peerLabel("ana", undefined, true)).toBe("ana");
  });

  it("says where a player stands and what today still allows", () => {
    expect(virtueLine(state(), "Builder of Light")).toBe("✦ Gardener · 345 · 255 to Builder of Light");
    expect(virtueLine(state({ title: "Divine", level: 7, toNext: null, points: 12000 }), null)).toBe("✦ Divine · 12000 · Divine");
    expect(todayLine(state())).toBe("today: built 120/300, helped 30/300");
  });

  it("measures progress through the current level", () => {
    const levels = LEVELS.map(([p]) => p);
    expect(levelProgress(state({ points: 400, toNext: 200 }), levels)).toBeCloseTo(0.5);
    expect(levelProgress(state({ level: -1, points: -20, toNext: 20 }), levels)).toBe(0);
    expect(levelProgress(state({ level: 7, toNext: null }), levels)).toBe(1);
  });
});

describe("blessings", () => {
  it("names the gifts of a level", () => {
    expect(
      blessingLine({ level: 2, title: "Gardener", gifts: [{ item: "light_sapling", name: "Light Sapling", count: 4 }, { item: "halo_bloom", name: "Halo Bloom", count: 8 }] }),
    ).toBe("✦ Blessed as Gardener: 4 Light Sapling, 8 Halo Bloom");
  });
});
