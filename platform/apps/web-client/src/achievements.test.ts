import { describe, expect, it } from "vitest";
import { achievementTree, type AchievementDef } from "./achievements";

const a = (key: string, parent?: string): AchievementDef => ({ key, name: key, description: "", parent, icon: "stick", xp: 0, trigger: { kind: "mine", count: 1 } });

describe("achievement tree", () => {
  it("orders children after their parents with depth", () => {
    const tree = achievementTree([a("c", "b"), a("b", "a"), a("a"), a("x"), a("orphan", "missing")]);
    expect(tree.map((t) => `${t.def.key}${t.depth}`)).toEqual(["a0", "b1", "c2", "x0", "orphan0"]);
  });
});
