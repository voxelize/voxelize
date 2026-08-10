import { afterEach, describe, expect, it, vi } from "vitest";

import { FrameSampler } from "./frame-sampler";

const VSYNC_60 = 1000 / 60;

/** Drives a sampler over a scripted list of frame intervals against a clock we
 * own, so a reading can be attributed to the intervals that produced it. */
const runFrames = (
  sampler: FrameSampler,
  intervals: readonly number[],
  clock: { now: number },
) => {
  sampler.update();
  for (const ms of intervals) {
    clock.now += ms;
    sampler.update();
  }
};

const useClock = () => {
  const clock = { now: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  return clock;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FrameSampler cadence", () => {
  it("reads a steady 60 as 60 fps with nothing dropped", () => {
    const clock = useClock();
    const sampler = new FrameSampler({ historySize: 80, publishIntervalMs: 0 });

    runFrames(sampler, Array(80).fill(VSYNC_60), clock);

    expect(sampler.fps).toBe(60);
    expect(sampler.droppedFrames).toBe(0);
    expect(sampler.frameMs).toBeCloseTo(16.7, 1);
  });

  it("does not let one stall dictate the rate for the rest of the window", () => {
    const clock = useClock();
    const sampler = new FrameSampler({ historySize: 80, publishIntervalMs: 0 });

    // The captured repro: a single 234ms hitch among otherwise perfect frames
    // pulled the old mean-based reading down to 43 fps for 1.4 seconds after
    // the hitch was over. The rate must stay honest and the hitch must still
    // be reported -- by the readings that exist to report it.
    const intervals = Array(80).fill(VSYNC_60);
    intervals[20] = 234;
    runFrames(sampler, intervals, clock);

    expect(sampler.fps).toBe(60);
    expect(sampler.worstFrameMs).toBeCloseTo(234, 0);
    expect(sampler.droppedFrames).toBe(13);
  });

  it("counts every refresh missed, not just the frames that missed one", () => {
    const clock = useClock();
    const sampler = new FrameSampler({ historySize: 80, publishIntervalMs: 0 });

    const intervals = Array(80).fill(VSYNC_60);
    intervals[10] = VSYNC_60 * 2;
    intervals[30] = VSYNC_60 * 4;
    runFrames(sampler, intervals, clock);

    expect(sampler.droppedFrames).toBe(1 + 3);
  });

  it("keeps a multi-second stall in the record instead of discarding it", () => {
    const clock = useClock();
    const sampler = new FrameSampler({ historySize: 80, publishIntervalMs: 0 });

    const intervals = Array(80).fill(VSYNC_60);
    intervals[40] = 4000;
    runFrames(sampler, intervals, clock);

    expect(sampler.worstFrameMs).toBeCloseTo(4000, 0);
    expect(sampler.droppedFrames).toBeGreaterThan(200);
    expect(sampler.fps).toBe(60);
  });

  it("reports the slow rate when the client is genuinely slow", () => {
    const clock = useClock();
    const sampler = new FrameSampler({ historySize: 80, publishIntervalMs: 0 });

    runFrames(sampler, Array(80).fill(VSYNC_60 * 2), clock);

    expect(sampler.fps).toBe(30);
    expect(sampler.droppedFrames).toBe(0);
  });
});

describe("FrameSampler intervals it refuses", () => {
  it("produces no reading from a single frame", () => {
    useClock();
    const sampler = new FrameSampler({ publishIntervalMs: 0 });

    sampler.update();

    expect(sampler.frames).toHaveLength(0);
    expect(sampler.fps).toBe(0);
  });

  it("finds the pause itself instead of waiting to be told about it", () => {
    const clock = useClock();
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
      removeEventListener: (type: string) => {
        delete listeners[type];
      },
    });

    const sampler = new FrameSampler({ historySize: 80, publishIntervalMs: 0 });
    runFrames(sampler, Array(10).fill(VSYNC_60), clock);
    const before = sampler.frames.length;

    clock.now += 30_000;
    listeners.visibilitychange?.();
    sampler.update();

    expect(sampler.frames.length).toBe(before);

    sampler.dispose();
    expect(listeners.visibilitychange).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("skips exactly the interval that spans a rendering pause", () => {
    const clock = useClock();
    const sampler = new FrameSampler({ historySize: 80, publishIntervalMs: 0 });

    runFrames(sampler, Array(10).fill(VSYNC_60), clock);
    const before = sampler.frames.length;

    clock.now += 30_000;
    sampler.noteRenderingResumed();
    sampler.update();
    expect(sampler.frames.length).toBe(before);

    clock.now += VSYNC_60;
    sampler.update();
    expect(sampler.frames.length).toBe(before + 1);
    expect(sampler.worstFrameMs).toBeLessThan(100);
  });
});
