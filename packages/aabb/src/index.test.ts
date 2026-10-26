import { describe, expect, it } from "vitest";

import { AABB } from ".";

const unitAt = (x: number, y: number, z: number) =>
  new AABB(x, y, z, x + 1, y + 1, z + 1);

describe("touches", () => {
  it("is true for boxes sharing a face", () => {
    expect(unitAt(0, 0, 0).touches(unitAt(1, 0, 0))).toBe(true);
  });

  it("is true for boxes sharing only an edge", () => {
    expect(unitAt(0, 0, 0).touches(unitAt(1, 1, 0))).toBe(true);
  });

  it("is false for overlapping boxes", () => {
    expect(unitAt(0, 0, 0).touches(new AABB(0.5, 0, 0, 1.5, 1, 1))).toBe(
      false,
    );
  });

  it("is false for separated boxes whose faces line up on another axis", () => {
    expect(unitAt(0, 0, 0).touches(unitAt(3, 1, 0))).toBe(false);
  });
});
