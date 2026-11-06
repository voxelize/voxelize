import { describe, expect, it } from "vitest";

import {
  analyticColorFromLevels,
  BLOCK_LIGHT_TRANSFER,
  blockLightCurve,
  blockLightCurveRGB,
} from "./block-light-transfer";

const out: [number, number, number] = [0, 0, 0];
const curveRGB = (r: number, g: number, b: number) => [
  ...blockLightCurveRGB(r / 15, g / 15, b / 15, out),
];

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

  it("changes nothing at whole levels or for the peak channel", () => {
    for (let r = 0; r <= 15; r++) {
      for (let g = 0; g <= 15; g += 3) {
        for (let b = 0; b <= 15; b += 5) {
          // At whole levels the ramp is complete: each channel keeps
          // exactly its gap's share of the peak's brightness.
          const peak = Math.max(r, g, b);
          const bright = blockLightCurve(peak / 15);
          const share = (level: number) =>
            level > 0
              ? Math.min(
                  Math.max(
                    1 - (peak - level) / BLOCK_LIGHT_TRANSFER.hueLevels,
                    0,
                  ),
                  1,
                )
              : 0;
          const [cr, cg, cb] = curveRGB(r, g, b);
          expect(cr).toBeCloseTo(bright * share(r), 12);
          expect(cg).toBeCloseTo(bright * share(g), 12);
          expect(cb).toBeCloseTo(bright * share(b), 12);
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

describe("flood hue fill from the claiming lights", () => {
  // A lamp's flood: red 15, green 12, blue 8, each one level down per block.
  const lamp = [15, 12, 8];
  const lampColor = analyticColorFromLevels(15, 12, 8);
  const filled = (r: number, g: number, b: number) => [
    ...blockLightCurveRGB(r / 15, g / 15, b / 15, out, lampColor),
  ];
  const hueOf = ([r, g, b]: number[]) => [g / r, b / r];

  it("keeps a lamp's hue to the last block of its pool", () => {
    const [coreGreen, coreBlue] = hueOf(filled(15, 12, 8));
    for (let distance = 8; distance < 15; distance++) {
      const [r, g, b] = lamp.map((level) => Math.max(level - distance, 0));
      const [green, blue] = hueOf(filled(r, g, b));
      // Without the fill these went to 0: orange, then pure red.
      expect(green).toBeCloseTo(coreGreen, 6);
      expect(blue).toBeCloseTo(coreBlue, 6);
      expect(hueOf(curveRGB(r, g, b))[1]).toBe(0);
    }
  });

  it("leaves channels that are still lit, and the brightness, unchanged", () => {
    for (let distance = 0; distance < 15; distance++) {
      const [r, g, b] = lamp.map((level) => Math.max(level - distance, 0));
      const plain = curveRGB(r, g, b);
      const withFill = filled(r, g, b);
      expect(withFill[0]).toBe(plain[0]);
      if (g > 0) expect(withFill[1]).toBe(plain[1]);
      if (b > 0) expect(withFill[2]).toBe(plain[2]);
    }
  });

  it("is the plain curve with no fill, a zero fill, or a fill that lacks the channel", () => {
    for (let r = 0; r <= 15; r += 3) {
      for (let g = 0; g <= 15; g += 5) {
        const plain = curveRGB(r, g, 0);
        expect([
          ...blockLightCurveRGB(r / 15, g / 15, 0, out, [0, 0, 0]),
        ]).toEqual(plain);
        // A pure red light's claim gives a dead green or blue nothing, and
        // a dead red under a green peak takes nothing from it either.
        expect([
          ...blockLightCurveRGB(r / 15, g / 15, 0, out, [1, 0, 0]),
        ]).toEqual(r >= g ? plain : curveRGB(r, g, 0));
      }
    }
  });

  it("never gives a dead channel more than its gap allows", () => {
    // A dead channel's gap is at least the peak's level, so near a bright
    // core a claim from a white light cannot whiten a pure red flood.
    const [, g, b] = blockLightCurveRGB(14 / 15, 0, 0, out, [1, 1, 1]);
    expect(g).toBe(0);
    expect(b).toBe(0);
    const [r5, g5] = blockLightCurveRGB(5 / 15, 0, 0, out, [1, 1, 1]);
    expect(g5 / r5).toBeCloseTo(1 - 5 / BLOCK_LIGHT_TRANSFER.hueLevels, 6);
  });
});
