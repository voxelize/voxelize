import { describe, expect, it } from "vitest";
import { payLine, progressLine, rewardLine } from "./work";

describe("work panel helpers", () => {
  it("show progress and pay", () => {
    expect(progressLine({ key: "a", name: "A", description: "", crowns: 1, xp: 1, count: 64, progress: 70, done: true })).toBe("64 / 64");
    expect(payLine({ key: "miner", name: "Miner", description: "", icon: "x", pays: [{ trigger: { kind: "mine", target: "stone" }, cents: 4 }, { trigger: { kind: "kill" }, cents: 100 }] })).toBe(
      "mine stone: 0.04, kill anything: 1.00",
    );
  });
  it("explain payouts and the daily limit", () => {
    expect(rewardLine({ source: "job", reason: "miner", paid: 3, requested: 3 })).toBe("Paid 3 Crowns for work as miner");
    expect(rewardLine({ source: "quest", reason: "Timber!", paid: 10, requested: 25 })).toBe("Paid 10 Crowns for quest Timber! (daily limit reached)");
    expect(rewardLine({ source: "quest", reason: "Timber!", paid: 0, requested: 25 })).toContain("limit");
  });
});
