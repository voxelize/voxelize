import { describe, expect, it } from "vitest";
import { arrowAt, fuseLit } from "./combat-view";

describe("combat view", () => {
  it("moves arrows on under gravity", () => {
    const [x, y, z] = arrowAt({ id: 1, pos: [0, 10, 0], vel: [10, 0, 0] }, 0.5);
    expect([x, z]).toEqual([5, 0]);
    expect(y).toBeCloseTo(10 - 2.5);
  });
  it("flashes fuses faster near the end", () => {
    expect([0, 0.2, 0.4].map((t) => fuseLit(3, t))).toEqual([true, true, false]);
    expect(fuseLit(0.5, 0.13)).toBe(false);
  });
});
