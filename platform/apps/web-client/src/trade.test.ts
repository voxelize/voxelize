import { describe, expect, it } from "vitest";

import { nearest } from "./trade";

describe("trade partner", () => {
  it("is the nearest player within range", () => {
    const me = { x: 0, y: 70, z: 0 };
    expect(nearest(me, [])).toBeNull();
    expect(nearest(me, [["far", { x: 20, y: 70, z: 0 }]])).toBeNull();
    expect(
      nearest(me, [
        ["b", { x: 5, y: 70, z: 0 }],
        ["a", { x: 2, y: 70, z: 1 }],
      ]),
    ).toBe("a");
  });
});
