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
