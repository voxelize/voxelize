import { describe, expect, it } from "vitest";

import { WalkSway } from "./walk-sway";

const DT = 1 / 60;

const walk = (
  sway: WalkSway,
  amplitude: number,
  seconds: number,
  onFrame?: (phase: number) => void,
) => {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    const phase = i * DT * 14;
    sway.update(Math.sin(phase) * amplitude, DT);
    onFrame?.(phase);
  }
};

describe("WalkSway", () => {
  it("a walk rocks side to side evenly and dips twice a stride", () => {
    const sway = new WalkSway();
    let min = 0;
    let max = 0;
    let maxDip = 0;
    walk(sway, 1.4, 3, () => {
      min = Math.min(min, sway.roll);
      max = Math.max(max, sway.roll);
      maxDip = Math.max(maxDip, sway.dip);
    });
    expect(max).toBeGreaterThan(0.6);
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeCloseTo(-max, 1);
    expect(maxDip).toBeGreaterThan(0.6);
    expect(sway.dip).toBeGreaterThanOrEqual(0);
  });

  it("leans over the planted foot: left while the right foot swings forward", () => {
    const sway = new WalkSway();
    walk(sway, 1.4, 2);
    // Hold the rising half of a stride (right foot travelling forward).
    for (let i = 0; i < 6; i++) sway.update(-0.3 + i * 0.1, DT);
    expect(sway.roll).toBeGreaterThan(0);
  });

  it("never jumps between frames", () => {
    const sway = new WalkSway();
    let last = 0;
    let worst = 0;
    walk(sway, 1.4, 3, () => {
      worst = Math.max(worst, Math.abs(sway.roll - last));
      last = sway.roll;
    });
    expect(worst).toBeLessThan(0.35);
  });

  it("an idle arm-and-leg drift does not sway the body", () => {
    const sway = new WalkSway();
    walk(sway, 0.06, 3);
    expect(sway.roll).toBe(0);
    expect(sway.dip).toBe(0);
  });

  it("settles back upright once the legs stop", () => {
    const sway = new WalkSway();
    walk(sway, 1.4, 2);
    for (let i = 0; i < 180; i++) sway.update(0, DT);
    expect(Math.abs(sway.roll)).toBeLessThan(0.01);
    expect(sway.dip).toBeLessThan(0.01);
  });
});
