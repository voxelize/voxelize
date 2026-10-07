import { describe, expect, it } from "vitest";
import { apply, colorMatrixValues, daltonize, SIMULATION } from "./colour-vision";

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

describe("colour vision aids", () => {
  it("leaves normal vision alone", () => {
    expect(daltonize("normal")).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(colorMatrixValues(daltonize("normal"))).toBe("1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0");
  });
  it("pulls confused colours apart for each deficiency", () => {
    const pairs: Record<keyof typeof SIMULATION, [[number, number, number], [number, number, number]]> = {
      protanopia: [[0.8, 0.2, 0.1], [0.4, 0.5, 0.1]],
      deuteranopia: [[0.8, 0.2, 0.1], [0.4, 0.5, 0.1]],
      tritanopia: [[0.2, 0.3, 0.8], [0.3, 0.5, 0.4]],
    };
    for (const [kind, [a, b]] of Object.entries(pairs) as [keyof typeof SIMULATION, typeof pairs.protanopia][]) {
      const seen = (c: [number, number, number], m = daltonize("normal")) => apply(SIMULATION[kind], apply(m, c));
      const before = distance(seen(a), seen(b));
      const after = distance(seen(a, daltonize(kind)), seen(b, daltonize(kind)));
      expect(after, kind).toBeGreaterThan(before * 1.2);
    }
  });
});
