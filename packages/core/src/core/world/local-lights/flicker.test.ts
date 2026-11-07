import { describe, expect, it } from "vitest";

import {
  FLICKER_GUTTER_DEPTH,
  FLICKER_SHIVER_PER_AMPLITUDE,
  sampleFlicker,
} from "./flicker";

const TORCH = { speed: 2.2, amplitude: 0.1 };

function trace(
  speed: number,
  amplitude: number,
  phase: number,
  seconds: number,
  step = 1 / 120,
) {
  const out = new Float32Array(4);
  const rows: number[][] = [];
  for (let t = 0; t < seconds; t += step) {
    sampleFlicker(speed, amplitude, phase, t, out);
    rows.push([...out]);
  }
  return rows;
}

describe("flame flicker", () => {
  it("only dims, never past its amplitude's reach, and is steady at zero", () => {
    const rows = trace(TORCH.speed, TORCH.amplitude, 1.3, 60);
    const scales = rows.map((r) => r[0]);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(
      1 - TORCH.amplitude * (1 + FLICKER_GUTTER_DEPTH) - 1e-6,
    );
    for (const r of trace(6, 0, 1.3, 2)) {
      expect(r[0]).toBe(1);
      expect(Math.hypot(r[1], r[2], r[3])).toBe(0);
    }
  });

  it("does not repeat on a short beat the eye can lock onto", () => {
    const step = 1 / 120;
    const scales = trace(TORCH.speed, TORCH.amplitude, 0.7, 20, step).map(
      (r) => r[0],
    );
    const mean = scales.reduce((a, b) => a + b, 0) / scales.length;
    const centred = scales.map((s) => s - mean);
    const energy = centred.reduce((a, b) => a + b * b, 0);
    // The old two-sine product matched itself at 0.93 after 1.42 s (a beat
    // you could count); the flame's best match over 0.2-3 s is ~0.5.
    let best = 0;
    for (let lag = Math.round(0.2 / step); lag < 3 / step; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < centred.length; i++) {
        sum += centred[i] * centred[i + lag];
      }
      best = Math.max(best, sum / energy);
    }
    expect(best).toBeLessThan(0.8);
  });

  it("never strobes: a 60 fps frame moves the light by under 2%", () => {
    // The first take (speed 6, partials up to 17 Hz, a 10 Hz flutter in the
    // dips) read as the room flashing, not a flame.
    const rows = trace(TORCH.speed, TORCH.amplitude, 0.9, 60, 1 / 60);
    let worst = 0;
    for (let i = 1; i < rows.length; i++) {
      worst = Math.max(worst, Math.abs(rows[i][0] - rows[i - 1][0]));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it("gutters now and then, not all the time", () => {
    const rows = trace(TORCH.speed, TORCH.amplitude, 2.1, 120);
    const deep = rows.filter((r) => r[0] < 1 - TORCH.amplitude * 1.2).length;
    const share = deep / rows.length;
    expect(share).toBeGreaterThan(0.005);
    expect(share).toBeLessThan(0.15);
  });

  it("sways a few centimetres, scaled by amplitude, and sinks as it dims", () => {
    const rows = trace(TORCH.speed, TORCH.amplitude, 0.4, 30);
    const radius = TORCH.amplitude * FLICKER_SHIVER_PER_AMPLITUDE;
    let sinkWhenDim = 0;
    let sinkWhenBright = 0;
    for (const [scale, dx, dy, dz] of rows) {
      expect(Math.abs(dx)).toBeLessThanOrEqual(radius + 1e-6);
      expect(Math.abs(dz)).toBeLessThanOrEqual(radius + 1e-6);
      expect(Math.abs(dy)).toBeLessThanOrEqual(radius + 1e-6);
      if (scale < 1 - TORCH.amplitude * 0.8) sinkWhenDim += dy;
      if (scale > 1 - TORCH.amplitude * 0.2) sinkWhenBright += dy;
    }
    expect(sinkWhenDim).toBeLessThan(0);
    expect(sinkWhenBright).toBeGreaterThan(0);
  });

  it("puts two torches at different points of their flicker", () => {
    const a = new Float32Array(4);
    const b = new Float32Array(4);
    sampleFlicker(6, 0.1, 0.3, 12.5, a);
    sampleFlicker(6, 0.1, 4.1, 12.5, b);
    expect(a[0]).not.toBeCloseTo(b[0], 4);
  });
});
