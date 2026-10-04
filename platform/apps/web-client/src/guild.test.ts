import { describe, expect, it } from "vitest";
import { guildActions, siegeLine, landNotice, newMessages, normaliseTag, parseTax, relationLine, settlementLine, validTag } from "./guild";

describe("guild panel", () => {
  it("lets the leader appoint and officers only remove members", () => {
    expect(guildActions("leader", "member", false)).toEqual(["promote", "lead", "kick"]);
    expect(guildActions("leader", "officer", false)).toEqual(["demote", "lead", "kick"]);
    expect(guildActions("officer", "member", false)).toEqual(["kick"]);
    expect(guildActions("officer", "officer", false)).toEqual([]);
    expect(guildActions("member", "member", false)).toEqual([]);
    expect(guildActions("leader", "leader", true)).toEqual([]);
    expect(guildActions("member", "member", false, true)).toEqual(["kick"], );
    expect(guildActions("member", "officer", false, true)).toEqual([]);
    expect(siegeLine({ progress: 30, needed: 60, contested: true })).toBe("Siege 50% · contested");
    expect(siegeLine({ progress: 90, needed: 60, contested: false })).toBe("Siege 100%");
  });

  it("normalises tags", () => {
    expect(normaliseTag(" sw ")).toBe("SW");
    expect(validTag("sw")).toBe(true);
    expect(validTag("a")).toBe(false);
    expect(validTag("TOOLONG")).toBe(false);
  });

  it("names settlements when walking onto guild land", () => {
    const land = { id: "L", name: "Hall", owner: { id: "a", name: "ann" }, role: null, public: { build: false, containers: false, use: false, animals: false }, min: [0, 0] as [number, number], max: [1, 1] as [number, number] };
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

  it("describes relations and parses taxes", () => {
    const base = { id: "r", with: { id: "B", name: "Bravo", tag: "BB" }, starts_at: null, ends_at: null, score: null, peace_offered: null } as const;
    expect(relationLine({ ...base, kind: "alliance", status: "active", initiated: true, fighting: false })).toBe("Allied with [BB] Bravo");
    expect(relationLine({ ...base, kind: "alliance", status: "proposed", initiated: false, fighting: false })).toBe("[BB] Bravo offers an alliance");
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(relationLine({ ...base, kind: "war", status: "active", initiated: true, fighting: false, starts_at: "2026-01-01T00:09:30Z", score: { us: 0, them: 0 } }, now)).toBe(
      "war in 10 min with [BB] Bravo · 0:0",
    );
    expect(relationLine({ ...base, kind: "war", status: "active", initiated: false, fighting: true, score: { us: 3, them: 1 }, peace_offered: "them" })).toBe(
      "at war with [BB] Bravo · 3:1 · they offer peace",
    );
    expect(parseTax("7.5")).toBe(750);
    expect(parseTax("20")).toBe(2000);
    expect(parseTax("21")).toBeNull();
    expect(parseTax("x")).toBeNull();
  });

  it("keeps only new chat lines, in order", () => {
    const m = (id: number) => ({ id, from: { id: "x", name: "x" }, body: String(id), at: "" });
    expect(newMessages([m(5), m(3), m(4)], 3).map((x) => x.id)).toEqual([4, 5]);
  });
});
