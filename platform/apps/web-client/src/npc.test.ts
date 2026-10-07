import { describe, expect, it } from "vitest";
import { affordable, offerLine } from "./npc";

describe("villager offers", () => {
  const offer = { give: { item: "gold_ingot", count: 1 }, take: [{ item: "wheat", count: 20 }] };
  it("read as what you give for what you get", () => {
    expect(offerLine(offer)).toBe("20 wheat → 1 gold_ingot");
    expect(offerLine(offer, (k) => (k === "wheat" ? "Wheat" : "Gold Ingot"))).toBe("20 Wheat → 1 Gold Ingot");
  });
  it("know when you can pay", () => {
    expect(affordable(offer, () => 19)).toBe(false);
    expect(affordable(offer, () => 20)).toBe(true);
  });
});
