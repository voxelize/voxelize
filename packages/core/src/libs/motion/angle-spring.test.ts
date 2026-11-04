import { describe, expect, it, vi } from "vitest";

import { AngleSpring, HeadLookMotion } from "./angle-spring";
import { computeHeadLook, MAX_HEAD_YAW } from "./head-look";

/** Turn from 0 to `target` at `fps`, returning the angle at each frame. */
const run = (omega: number, target: number, fps: number, seconds: number) => {
  const spring = new AngleSpring(omega);
  const out: number[] = [];
  let angle = 0;
  let now = 1000;
  spring.step(angle, angle, now);
  for (let i = 0; i < seconds * fps; i++) {
    now += 1000 / fps;
    angle = spring.step(angle, target, now);
    out.push(angle);
  }
  return out;
};

describe("AngleSpring", () => {
  it("eases into a turn instead of leaping on the first frame", () => {
    const [first] = run(13, 1, 60, 0.1);
    // A 0.35-per-frame share moved 35% of the turn on frame one.
    expect(first).toBeLessThan(0.05);
  });

  it("settles a 60 degree head turn in about 0.35 s without overshoot", () => {
    const target = Math.PI / 3;
    const path = run(13, target, 60, 1);
    const at = (s: number) => path[Math.round(s * 60) - 1];
    expect(at(0.35) / target).toBeGreaterThan(0.9);
    expect(at(0.15) / target).toBeLessThan(0.6);
    expect(Math.max(...path)).toBeLessThanOrEqual(target + 1e-6);
  });

  it("takes the same time at any frame rate", () => {
    const at60 = run(13, 1, 60, 0.3).at(-1)!;
    const at144 = run(13, 1, 144, 0.3).at(-1)!;
    expect(Math.abs(at60 - at144)).toBeLessThan(0.02);
  });

  it("turns the short way round across the seam", () => {
    const spring = new AngleSpring(13);
    spring.step(3.0, 3.0, 1000);
    const next = spring.step(3.0, -3.0, 1100);
    expect(next).toBeGreaterThan(3.0);
  });
});

describe("computeHeadLook with motion", () => {
  it("stops at the neck's limit instead of winding up past it", () => {
    let clock = 1000;
    const now = vi
      .spyOn(performance, "now")
      .mockImplementation(() => (clock += 16));
    const motion = new HeadLookMotion();
    let yaw = 0;
    // A target straight behind: the head swings to its limit and holds.
    for (let i = 0; i < 120; i++) {
      const r = computeHeadLook([0, 0, -5], 0, 0, 0, 0, 0, yaw, 0, motion);
      yaw = r.smoothedHeadYaw;
      expect(Math.abs(r.headYawDelta)).toBeLessThanOrEqual(MAX_HEAD_YAW);
    }
    expect(motion.yaw.velocity).toBe(0);
    now.mockRestore();
  });
});
