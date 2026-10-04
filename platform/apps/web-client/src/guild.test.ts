import { describe, expect, it } from "vitest";
import { guildActions, normaliseTag, validTag } from "./guild";

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
});
