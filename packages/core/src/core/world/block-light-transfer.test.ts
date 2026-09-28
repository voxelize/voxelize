import { afterEach, describe, expect, it } from "vitest";

import {
  BLOCK_LIGHT_TUNING,
  blockLightCurve,
  blockLightCurveRGB,
} from "./block-light-transfer";

const out: [number, number, number] = [0, 0, 0];
const curveRGB = (r: number, g: number, b: number) => [
  ...blockLightCurveRGB(r / 15, g / 15, b / 15, out),
];

afterEach(() => {
  BLOCK_LIGHT_TUNING.hueRamp.value = 1;
});

describe("flood hue ramp", () => {
  it("fades a weaker channel in from zero instead of snapping it on", () => {
    // Red at level 6 over a cyan flood's last level: green sits between a
    // lit corner (level 1) and a dark one (0).
    const lit = curveRGB(6, 1, 1)[1];
    expect(lit).toBeGreaterThan(0.05);
    let previous = 0;
    for (let step = 0; step <= 20; step++) {
      const green = curveRGB(6, step / 20, step / 20)[1];
      expect(green).toBeGreaterThanOrEqual(previous);
      // No jump: at most twice the average slope over one sample (the
      // legacy share leapt to most of `lit` on the first one).
      expect(green - previous).toBeLessThanOrEqual((2 * lit) / 20);
      previous = green;
    }
    expect(previous).toBeCloseTo(lit, 12);
    expect(curveRGB(6, 1e-3, 0)[1]).toBeLessThan(0.01 * lit);
  });

  it("snapped on at any trace of the channel with the ramp off (legacy)", () => {
    BLOCK_LIGHT_TUNING.hueRamp.value = 0;
    const lit = curveRGB(6, 1, 1)[1];
    expect(curveRGB(6, 1e-3, 0)[1]).toBeGreaterThan(0.8 * lit);
  });

  it("changes nothing at whole levels or for the peak channel", () => {
    for (let r = 0; r <= 15; r++) {
      for (let g = 0; g <= 15; g += 3) {
        for (let b = 0; b <= 15; b += 5) {
          BLOCK_LIGHT_TUNING.hueRamp.value = 0;
          const legacy = curveRGB(r, g, b);
          BLOCK_LIGHT_TUNING.hueRamp.value = 1;
          expect(curveRGB(r, g, b)).toEqual(legacy);
        }
      }
    }
    // A faint single-colour flood keeps its brightness curve below level 1.
    for (const level of [0.1, 0.4, 0.9]) {
      expect(curveRGB(level, 0, 0)[0]).toBeCloseTo(
        blockLightCurve(level / 15),
        12,
      );
      const [r, g, b] = curveRGB(level, level, level);
      expect([g, b]).toEqual([r, r]);
    }
  });
});
