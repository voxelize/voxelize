import { describe, expect, it } from "vitest";

import { StepEyeSmoother } from "./step-smoothing";

const SETTLE_TIME = 0.25;
const STEP = 1;
const MAX_LAG = 1.25;

function stepUp(smoother: StepEyeSmoother, rise = STEP) {
  smoother.noteStep(rise);
  smoother.absorbPending(MAX_LAG);
}

function run(smoother: StepEyeSmoother, seconds: number, dt: number) {
  const trace: number[] = [];
  const frames = Math.round(seconds / dt);
  for (let frame = 0; frame < frames; frame++) {
    smoother.advance(dt, SETTLE_TIME);
    trace.push(smoother.offset);
  }
  return trace;
}

describe("StepEyeSmoother", () => {
  it("holds the eye down by the full rise the frame the anchor jumps", () => {
    const smoother = new StepEyeSmoother();
    smoother.noteStep(STEP);

    // Not absorbed yet: the anchor has not been re-derived, so no offset.
    expect(smoother.offset).toBe(0);

    smoother.absorbPending(MAX_LAG);
    expect(smoother.offset).toBeCloseTo(-STEP, 12);
  });

  it("rises monotonically with no overshoot and settles 95% in the settle time", () => {
    const smoother = new StepEyeSmoother();
    stepUp(smoother);

    const trace = run(smoother, SETTLE_TIME, 1 / 120);

    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]);
      expect(trace[i]).toBeLessThanOrEqual(0);
    }

    const remaining = -trace[trace.length - 1];
    expect(remaining).toBeLessThan(0.06);
    expect(remaining).toBeGreaterThan(0.04);
  });

  it("is frame-rate independent", () => {
    const at120 = new StepEyeSmoother();
    const at24 = new StepEyeSmoother();
    stepUp(at120);
    stepUp(at24);

    run(at120, 0.25, 1 / 120);
    run(at24, 0.25, 1 / 24);

    expect(at120.offset).toBeCloseTo(at24.offset, 6);
  });

  it("starts gently instead of popping: the first frame moves far less than a lerp would", () => {
    const smoother = new StepEyeSmoother();
    stepUp(smoother);

    smoother.advance(1 / 60, SETTLE_TIME);

    // The old 0.6-per-frame lerp closed 60% of the gap on frame one.
    const closed = STEP + smoother.offset;
    expect(closed).toBeLessThan(0.1);
    expect(closed).toBeGreaterThan(0);
  });

  it("stacks staircase steps into one trailing offset and clips it to the lag cap", () => {
    const smoother = new StepEyeSmoother();
    stepUp(smoother);
    run(smoother, 0.05, 1 / 60);
    const afterFirst = smoother.offset;
    expect(afterFirst).toBeGreaterThan(-STEP);

    stepUp(smoother);
    // Would be afterFirst - 1 (< -MAX_LAG); the cap holds the eye above the tread.
    expect(smoother.offset).toBeCloseTo(-MAX_LAG, 12);

    run(smoother, 1, 1 / 60);
    expect(smoother.offset).toBe(0);
    expect(smoother.isSettling).toBe(false);
  });

  it("parks at exactly zero once the tail is invisible", () => {
    const smoother = new StepEyeSmoother();
    stepUp(smoother);

    run(smoother, 2, 1 / 60);

    expect(smoother.offset).toBe(0);
    expect(smoother.isSettling).toBe(false);
  });

  it("snaps when easing is disabled", () => {
    const smoother = new StepEyeSmoother();
    stepUp(smoother);

    smoother.advance(1 / 60, 0);

    expect(smoother.offset).toBe(0);
  });

  it("reset drops the offset and any unabsorbed rise", () => {
    const smoother = new StepEyeSmoother();
    stepUp(smoother);
    smoother.noteStep(STEP);

    smoother.reset();
    smoother.absorbPending(MAX_LAG);

    expect(smoother.offset).toBe(0);
    expect(smoother.isSettling).toBe(false);
  });

  it("ignores non-finite rises", () => {
    const smoother = new StepEyeSmoother();
    smoother.noteStep(Number.NaN);
    smoother.absorbPending(MAX_LAG);

    expect(smoother.offset).toBe(0);
  });
});
