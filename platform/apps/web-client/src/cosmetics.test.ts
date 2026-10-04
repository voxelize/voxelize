import { describe, expect, it } from "vitest";
import type { Cosmetic } from "./api";
import { BASE_LOOK, cosmeticLine, lookColors, sanitizeLook } from "./cosmetics";

describe("cosmetics", () => {
  it("paints the defaults where nothing is worn", () => {
    expect(lookColors(null)).toEqual({ body: BASE_LOOK.body, arms: BASE_LOOK.arms, legs: BASE_LOOK.legs, hat: null });
    const c = lookColors({ outfit: { body: "#111111", arms: "#222222", legs: "#333333" }, hat: { art: "crown" } });
    expect(c).toEqual({ body: "#111111", arms: "#222222", legs: "#333333", hat: { art: "crown" } });
  });

  it("keeps only well formed looks from the network", () => {
    expect(sanitizeLook(null)).toBeNull();
    expect(sanitizeLook({})).toBeNull();
    expect(sanitizeLook({ outfit: { body: "red", arms: "#000000", legs: "#000000" } })).toBeNull();
    expect(sanitizeLook({ hat: { art: "<img>" } })).toBeNull();
    expect(sanitizeLook({ hat: { color: "#C0392B", extra: 1 } })).toEqual({ hat: { color: "#C0392B" } });
    expect(sanitizeLook({ outfit: { body: "#000000", arms: "#111111", legs: "#222222" }, hat: { art: "crown", color: "x" } })).toEqual({
      outfit: { body: "#000000", arms: "#111111", legs: "#222222" },
      hat: { art: "crown" },
    });
  });

  it("says what a cosmetic costs, or that it is owned or worn", () => {
    const crown: Cosmetic = { key: "hat_crown", name: "Crown", slot: "hat", price: 250, look: { art: "crown" } };
    expect(cosmeticLine(crown, { owned: [], equipped: {}, currency: "CRN" })).toBe("Crown · 250 CRN");
    expect(cosmeticLine(crown, { owned: ["hat_crown"], equipped: {}, currency: "CRN" })).toBe("Crown · owned");
    expect(cosmeticLine(crown, { owned: ["hat_crown"], equipped: { hat: "hat_crown" }, currency: "CRN" })).toBe("Crown · worn");
  });
});
