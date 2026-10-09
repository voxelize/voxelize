import { describe, expect, it } from "vitest";

import { dampTo, isSettled, median, type Spring } from "./smoothing";

/** Runs a spring toward `goal` for `seconds` at `fps` frames a second. */
function run(goal: number, settle: number, seconds: number, fps: number) {
  let spring: Spring = { value: 0, velocity: 0 };
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++)
    spring = dampTo(spring, goal, settle, 1 / fps);
  return spring;
}

describe("dampTo", () => {
  it("covers 90% of a change in the settle time", () => {
    const spring = dampTo({ value: 0, velocity: 0 }, 100, 0.6, 0.6);
    expect(spring.value).toBeCloseTo(90, 2);
  });

  it("moves the same at any frame rate", () => {
    const once = dampTo({ value: 0, velocity: 0 }, 100, 0.75, 1.5);
    for (const fps of [24, 30, 60, 144, 240]) {
      const stepped = run(100, 0.75, 1.5, fps);
      expect(stepped.value).toBeCloseTo(once.value, 9);
      expect(stepped.velocity).toBeCloseTo(once.velocity, 9);
    }
  });

  it("never passes its goal when released from rest", () => {
    let spring: Spring = { value: 0, velocity: 0 };
    let last = 0;
    for (let i = 0; i < 144 * 4; i++) {
      spring = dampTo(spring, 50, 0.5, 1 / 144);
      expect(spring.value).toBeGreaterThanOrEqual(last);
      expect(spring.value).toBeLessThanOrEqual(50);
      last = spring.value;
    }
    expect(isSettled(spring, 50, 0.01)).toBe(true);
  });

  it("snaps when the settle time is zero", () => {
    expect(dampTo({ value: 3, velocity: 9 }, 40, 0, 1 / 60)).toEqual({
      value: 40,
      velocity: 0,
    });
  });
});

describe("median", () => {
  it("ignores a lone outlier", () => {
    expect(median([80, 81, 80, 200, 79])).toBe(80);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
