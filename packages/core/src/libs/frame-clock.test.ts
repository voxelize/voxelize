import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  frameNow,
  framePaceMs,
  frameRefreshMs,
  frameRoomMs,
  frameStep,
  resetFrameClock,
  setFrameTime,
} from "./frame-clock";

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

describe("frame room", () => {
  beforeEach(() => resetFrameClock());
  afterEach(() => {
    resetFrameClock();
    vi.restoreAllMocks();
  });

  /** Issues frames `gapMs` apart. Returns the last frame's own time. */
  const play = (frames: number, gapMs: number, from = 1000): number => {
    let issued = from;
    for (let frame = 0; frame < frames; frame += 1) {
      issued = from + frame * gapMs;
      setFrameTime(issued);
      setFrameTime(null);
    }
    return issued;
  };

  it("has nothing to plan against before a host feeds the clock", () => {
    expect(frameRefreshMs()).toBe(0);
    expect(frameRoomMs(5)).toBeNull();
    setFrameTime(1000);
    setFrameTime(null);
    expect(frameRoomMs(1004)).toBeNull();
  });

  it("reads the display's refresh as the fastest pace frames come at", () => {
    const refresh = 1000 / 120;
    let issued = play(30, refresh);
    // A stretch of missed refreshes: frames two apart.
    for (let frame = 0; frame < 20; frame += 1) {
      issued += refresh * 2;
      setFrameTime(issued);
      setFrameTime(null);
    }
    expect(frameRefreshMs()).toBeCloseTo(refresh, 6);
    expect(framePaceMs()).toBeGreaterThan(refresh);
  });

  it("gives what is left of the planned share of a refresh", () => {
    const refresh = 1000 / 60;
    const issued = play(10, refresh);
    // The frame's own work ended 6 ms in.
    expect(frameRoomMs(issued + 6)).toBeCloseTo(refresh * 0.85 - 6, 6);
    // A frame that began late and ran long has none.
    expect(frameRoomMs(issued + 20)).toBeLessThan(0);
  });

  it("has no answer on an unpaced page or once frames have stopped", () => {
    const unpaced = play(10, 1.5);
    expect(frameRefreshMs()).toBe(0);
    expect(frameRoomMs(unpaced + 1)).toBeNull();
    resetFrameClock();
    const issued = play(10, 1000 / 60);
    expect(frameRoomMs(issued + 400)).toBeNull();
  });

  it("forgets a faster display once its frames have aged out", () => {
    let issued = play(10, 1000 / 120);
    for (let frame = 0; frame < 100; frame += 1) {
      issued += 1000 / 60;
      setFrameTime(issued);
      setFrameTime(null);
    }
    expect(frameRefreshMs()).toBeCloseTo(1000 / 60, 6);
  });
});
