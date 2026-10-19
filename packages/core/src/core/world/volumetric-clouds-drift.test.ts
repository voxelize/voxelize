import { describe, expect, it } from "vitest";

import { driftShift } from "./volumetric-clouds-drift";

describe("volumetric cloud drift", () => {
  const cell = 4;
  const noise = 128;
  const coverage = 3.3;

  // What the shader used to sample with the raw drift, in doubles.
  const raw = (p: number, drift: number) => ({
    noise: (p + drift) / (cell * noise),
    coverage: (p + drift) / (cell * noise * coverage),
  });
  const fract = (v: number) => v - Math.floor(v);

  it("samples the same field as the raw drift, a week into the clock", () => {
    for (const drift of [0, 13.7, 4321.25, 8 * 604_800.123]) {
      const shift = driftShift(drift, cell, noise, coverage);
      for (const p of [-900.5, 0, 37.25, 2048]) {
        const expected = raw(p, drift);
        expect(fract(p / (cell * noise) + shift.noise)).toBeCloseTo(
          fract(expected.noise),
          9,
        );
        expect(
          fract(p / (cell * noise * coverage) + shift.coverage),
        ).toBeCloseTo(fract(expected.coverage), 9);
      }
      // The cell grid lands on the same cell edges.
      expect(fract((drift - shift.grid) / cell)).toBeCloseTo(0, 9);
    }
  });

  it("keeps every shift small enough for a float32 uniform", () => {
    const shift = driftShift(8 * 1e9, cell, noise, coverage);
    expect(shift.grid).toBeGreaterThanOrEqual(0);
    expect(shift.grid).toBeLessThan(cell);
    expect(shift.noise).toBeGreaterThanOrEqual(0);
    expect(shift.noise).toBeLessThan(1);
    expect(shift.coverage).toBeGreaterThanOrEqual(0);
    expect(shift.coverage).toBeLessThan(1);
  });

  it("moves smoothly frame to frame at a large clock", () => {
    const clock = 3_000_000;
    const a = driftShift(8 * clock, cell, noise, coverage);
    const b = driftShift(8 * (clock + 1 / 60), cell, noise, coverage);
    const step = fract(b.grid / cell - a.grid / cell) * cell;
    expect(step).toBeCloseTo(8 / 60, 6);
  });
});
