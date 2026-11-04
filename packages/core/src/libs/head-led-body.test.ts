import { describe, expect, it } from "vitest";

import { HeadLedBody } from "./head-led-body";

const frames = (body: HeadLedBody, look: number, n: number, walk = 0) => {
  for (let i = 0; i < n; i++) body.update(look, 0, i * walk, 1 / 60);
};

describe("HeadLedBody", () => {
  it("a standing body holds still while its look stays within reach", () => {
    const body = new HeadLedBody();
    body.snap(0);
    frames(body, 0.5, 120);
    expect(body.yaw).toBe(0);
    expect(body.offset(0.5)).toBeCloseTo(0.5);
  });

  it("a look past reach turns the body round to face it, not just to the edge", () => {
    const body = new HeadLedBody();
    body.snap(0);
    frames(body, 1.6, 120);
    expect(Math.abs(body.offset(1.6))).toBeLessThanOrEqual(0.12 + 1e-6);
  });

  it("the turn takes time instead of snapping", () => {
    const body = new HeadLedBody();
    body.snap(0);
    frames(body, Math.PI * 0.9, 6);
    expect(body.yaw).toBeGreaterThan(0);
    expect(body.yaw).toBeLessThan(1);
  });

  it("a walking body faces its travel, leaning toward its look only up to reach", () => {
    const body = new HeadLedBody();
    body.snap(0);
    // Travelling +z (yaw 0) at 1.2 blocks/s while looking off to the side.
    frames(body, Math.PI / 2, 240, 0.02);
    expect(body.yaw).toBeCloseTo(Math.PI / 2 - 0.75, 1);
  });

  it("backing away from its look, a body keeps facing it", () => {
    const body = new HeadLedBody();
    body.snap(Math.PI);
    // Travelling +z while looking back down -z.
    frames(body, Math.PI, 240, 0.02);
    expect(Math.abs(body.offset(Math.PI))).toBeLessThan(0.05);
  });
});
