import { describe, expect, it } from "vitest";

import { boxSize } from "./blueprints";

describe("blueprint capture box", () => {
  it("spans the two corners inclusively and stays within limits", () => {
    expect(boxSize(null, [1, 2, 3])).toEqual({ ok: false, reason: "Mark two corners first" });
    expect(boxSize([0, 64, 0], [3, 66, -2])).toEqual({ ok: true, size: [4, 3, 3] });
    expect(boxSize([5, 5, 5], [5, 5, 5])).toEqual({ ok: true, size: [1, 1, 1] });
    expect(boxSize([0, 0, 0], [40, 0, 0]).ok).toBe(false);
  });
});

import { statusLabel, turnedSize } from "./blueprints";

describe("turning and reviewing blueprints", () => {
  it("swap x and z on odd turns", () => {
    expect(turnedSize([5, 3, 2], 0)).toEqual([5, 3, 2]);
    expect(turnedSize([5, 3, 2], 1)).toEqual([2, 3, 5]);
    expect(turnedSize([5, 3, 2], 2)).toEqual([5, 3, 2]);
  });
  it("name review states", () => {
    expect(statusLabel("in_review")).toBe("waiting for review");
    expect(statusLabel("something")).toBe("something");
  });
});
