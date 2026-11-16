import { afterEach, describe, expect, it, vi } from "vitest";

import { frameNow, frameStep, setFrameTime } from "./frame-clock";

describe("frame clock", () => {
  afterEach(() => {
    setFrameTime(null);
    vi.restoreAllMocks();
  });

  it("is the frame's own time while a frame is being drawn", () => {
    vi.spyOn(performance, "now").mockReturnValue(1012.5);
    setFrameTime(1000);
    // The callback began 12.5 ms after the refresh it draws for.
    expect(frameNow()).toBe(1000);
  });

  it("is the wall clock outside a frame", () => {
    vi.spyOn(performance, "now").mockReturnValue(1012.5);
    setFrameTime(1000);
    setFrameTime(null);
    expect(frameNow()).toBe(1012.5);
  });

  it("steps evenly through a callback that began late", () => {
    const now = vi.spyOn(performance, "now");
    const refresh = 1000 / 60;
    const steps: number[] = [];
    let previous = 0;
    // Three frames; the second one's callback is kept waiting 10 ms.
    for (const [frame, lateMs] of [
      [1, 0.2],
      [2, 10],
      [3, 0.2],
    ]) {
      now.mockReturnValue(frame * refresh + lateMs);
      setFrameTime(frame * refresh);
      steps.push(frameNow() - previous);
      previous = frameNow();
      setFrameTime(null);
    }
    expect(steps[1]).toBeCloseTo(refresh, 6);
    expect(steps[2]).toBeCloseTo(refresh, 6);
  });

  it("never hands out a negative or runaway step", () => {
    expect(frameStep(-0.004, 0.1)).toBe(0);
    expect(frameStep(0.016, 0.1)).toBe(0.016);
    expect(frameStep(2.5, 0.1)).toBe(0.1);
    expect(frameStep(2.5)).toBe(2.5);
  });
});
