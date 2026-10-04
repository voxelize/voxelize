import { describe, expect, it } from "vitest";
import { guildActions, landNotice, newMessages, normaliseTag, settlementLine, validTag } from "./guild";

describe("guild panel", () => {
  it("lets the leader appoint and officers only remove members", () => {
    expect(guildActions("leader", "member", false)).toEqual(["promote", "lead", "kick"]);
    expect(guildActions("leader", "officer", false)).toEqual(["demote", "lead", "kick"]);
    expect(guildActions("officer", "member", false)).toEqual(["kick"]);
    expect(guildActions("officer", "officer", false)).toEqual([]);
    expect(guildActions("member", "member", false)).toEqual([]);
    expect(guildActions("leader", "leader", true)).toEqual([]);
  });

  it("normalises tags", () => {
    expect(normaliseTag(" sw ")).toBe("SW");
    expect(validTag("sw")).toBe(true);
    expect(validTag("a")).toBe(false);
    expect(validTag("TOOLONG")).toBe(false);
  });

  it("names settlements when walking onto guild land", () => {
    const land = { id: "L", name: "Hall", owner: { id: "a", name: "ann" }, role: null, public: { build: false, containers: false, use: false }, min: [0, 0] as [number, number], max: [1, 1] as [number, number] };
    expect(landNotice(null)).toBe("Wilderness");
    expect(landNotice(land)).toBe("Hall — ann");
    expect(landNotice({ ...land, guild: { id: "G", name: "Stone Wardens", tag: "SW" } })).toBe("Hall — ann [SW]");
    expect(landNotice({ ...land, guild: { id: "G", name: "Stone Wardens", tag: "SW" }, settlement: { name: "Stone Wardens", level: "town" } })).toBe(
      "The town of Stone Wardens [SW] · Hall — ann",
    );
    expect(settlementLine({ world: "main", dimension: "overworld", lands: ["a"], chunks: 4, level: "village", min: [0, 0], max: [1, 1] })).toBe(
      "Village · 4 chunk(s) · 0,0 to 1,1 (overworld)",
    );
  });

  it("keeps only new chat lines, in order", () => {
    const m = (id: number) => ({ id, from: { id: "x", name: "x" }, body: String(id), at: "" });
    expect(newMessages([m(5), m(3), m(4)], 3).map((x) => x.id)).toEqual([4, 5]);
  });
});
