import { Vector2 } from "three";
import { describe, expect, it } from "vitest";

import { faceAnimationFrameAt } from "./face-animation-frame";
import { flickerPhaseAt } from "./local-lights/registry";
import {
  SHADER_CLOCK_WRAP_SECONDS,
  ShaderClock,
  slewShaderClock,
  windAt,
  wrapShaderSeconds,
} from "./shader-clock";

/** One client's shader clock over a run of frames against its shared clock. */
function simulate(
  shared: (t: number) => number,
  start: number,
  end: number,
  step: (frame: number) => number,
): { at: number; seconds: number }[] {
  const clock = new ShaderClock();
  const samples: { at: number; seconds: number }[] = [];
  let t = start;
  let frame = 0;
  while (t < end) {
    const dt = step(frame);
    frame += 1;
    t += dt;
    samples.push({ at: t, seconds: clock.advance(shared(t), dt) });
  }
  return samples;
}

describe("shared shader clock", () => {
  it("puts two clients that joined hours apart at the same moment", () => {
    // Real time `t`; the world's shared clock is `t + 90000` on both.
    const shared = (t: number) => t + 90000;
    const a = simulate(shared, 0, 60, () => 1 / 60);
    const b = simulate(
      shared,
      41.3,
      60,
      (f) => [1 / 24, 1 / 90, 1 / 45][f % 3],
    );
    const at = (samples: typeof a, t: number) =>
      samples.reduce((best, s) =>
        Math.abs(s.at - t) < Math.abs(best.at - t) ? s : best,
      );
    for (const t of [45, 50, 59]) {
      const sa = at(a, t);
      const sb = at(b, t);
      // Each tracks its own frame times; compare against where each should be.
      expect(sa.seconds - shared(sa.at)).toBeCloseTo(0, 6);
      expect(sb.seconds - shared(sb.at)).toBeCloseTo(0, 6);
    }
  });

  it("slews a small correction instead of jumping", () => {
    let current = slewShaderClock(Number.NaN, 1000, 1 / 60);
    expect(current).toBe(1000);
    // The shared clock is corrected 0.2s forward.
    let target = 1000.2;
    let biggestStep = 0;
    for (let i = 0; i < 300; i += 1) {
      target += 1 / 60;
      const next = slewShaderClock(current, target, 1 / 60);
      biggestStep = Math.max(biggestStep, next - current);
      current = next;
    }
    expect(biggestStep).toBeLessThanOrEqual((1 / 60) * 1.1 + 1e-9);
    expect(current).toBeCloseTo(target, 6);
  });

  it("keeps pace on a slow page instead of lagging and snapping", () => {
    const clock = new ShaderClock();
    let shared = 335000;
    let worst = 0;
    for (let i = 0; i < 40; i += 1) {
      shared += 0.5;
      clock.advance(shared, 0.5);
      worst = Math.max(worst, Math.abs(shared - clock.seconds));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("takes a real jump at once", () => {
    expect(slewShaderClock(1000, 1600, 1 / 60)).toBe(1600);
    expect(slewShaderClock(1000, 400, 1 / 60)).toBe(400);
  });

  it("wraps under float32's millisecond range, at the same moment everywhere", () => {
    expect(SHADER_CLOCK_WRAP_SECONDS * 1000).toBeLessThanOrEqual(2 ** 24);
    const ms = wrapShaderSeconds(123456789.25) * 1000;
    expect(Math.fround(ms)).toBeCloseTo(ms, 0);
    expect(wrapShaderSeconds(SHADER_CLOCK_WRAP_SECONDS * 3 + 5)).toBe(5);
    expect(wrapShaderSeconds(-1)).toBe(SHADER_CLOCK_WRAP_SECONDS - 1);
  });

  it("runs locally when switched off, for A/B", () => {
    const clock = new ShaderClock();
    clock.isShared = false;
    clock.advance(5000, 0.05);
    expect(clock.seconds).toBeCloseTo(0.05, 9);
  });
});

describe("wind", () => {
  it("is a function of the clock alone", () => {
    const dirA = new Vector2();
    const offA = new Vector2();
    const dirB = new Vector2();
    const offB = new Vector2();
    windAt(88000.5, 1, dirA, offA);
    windAt(88000.5, 1, dirB, offB);
    expect(offA.toArray()).toEqual(offB.toArray());
    expect(dirA.length()).toBeCloseTo(1, 9);
  });

  it("scrolls smoothly, at the speed the sway was tuned to", () => {
    const dir = new Vector2();
    const before = new Vector2();
    const after = new Vector2();
    for (const t of [10, 5000, 123456.7, 9.9e6]) {
      windAt(t, 1, dir, before);
      windAt(t + 1, 1, dir, after);
      const speed = after.distanceTo(before);
      // 0.05 units/s, give or take the meander's share.
      expect(speed).toBeGreaterThan(0.05 * 0.6);
      expect(speed).toBeLessThan(0.05 * 1.4);
    }
  });
});

describe("animated faces", () => {
  it("show the same frame for the same clock, whenever the atlas loaded", () => {
    const durations = [400, 400, 400];
    expect(faceAnimationFrameAt(durations, 0, 0)).toEqual({
      index: 0,
      next: 0,
      fadeStep: 0,
    });
    expect(faceAnimationFrameAt(durations, 0, 450).index).toBe(1);
    expect(faceAnimationFrameAt(durations, 0, 1250).index).toBe(0);
    const at = 90000123.4;
    expect(faceAnimationFrameAt(durations, 6, at)).toEqual(
      faceAnimationFrameAt(durations, 6, at),
    );
  });

  it("crossfades in fixed steps after each hold", () => {
    const frame = faceAnimationFrameAt([100, 100], 6, 100 + 1);
    expect(frame).toEqual({ index: 0, next: 1, fadeStep: 1 });
    const late = faceAnimationFrameAt([100, 100], 6, 100 + 6 * (1000 / 60) - 1);
    expect(late.fadeStep).toBe(6);
    const next = faceAnimationFrameAt([100, 100], 6, 100 + 6 * (1000 / 60) + 1);
    expect(next).toEqual({ index: 1, next: 1, fadeStep: 0 });
  });
});

describe("light flicker", () => {
  it("keys a torch's phase to its voxel, not its registry slot", () => {
    expect(flickerPhaseAt(10.5, 64.5, -3.5)).toBe(
      flickerPhaseAt(10.2, 64.9, -3.1),
    );
    expect(flickerPhaseAt(10.5, 64.5, -3.5)).not.toBe(
      flickerPhaseAt(11.5, 64.5, -3.5),
    );
    const phase = flickerPhaseAt(0, 0, 0);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(Math.PI * 2);
  });
});
