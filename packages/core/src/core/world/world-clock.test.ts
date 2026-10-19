import { describe, expect, it } from "vitest";

import {
  advanceWorldClock,
  clockStepSince,
  elapsedSeconds,
  isClockDriftBeyond,
} from "./world-clock";

const TIME_PER_DAY = 24000;

describe("advanceWorldClock", () => {
  it("advances the time of day within a day", () => {
    expect(advanceWorldClock({ day: 3, time: 100 }, 0.5, TIME_PER_DAY)).toEqual(
      { day: 3, time: 100.5 },
    );
  });

  it("counts a wrap past midnight as a completed day", () => {
    const next = advanceWorldClock(
      { day: 3, time: TIME_PER_DAY - 0.01 },
      0.05,
      TIME_PER_DAY,
    );
    expect(next.day).toBe(4);
    expect(next.time).toBeCloseTo(0.04, 6);
  });

  it("keeps the unwrapped clock continuous across the wrap", () => {
    const before = { day: 3, time: TIME_PER_DAY - 0.01 };
    const after = advanceWorldClock(before, 0.05, TIME_PER_DAY);
    expect(
      elapsedSeconds(after, TIME_PER_DAY) -
        elapsedSeconds(before, TIME_PER_DAY),
    ).toBeCloseTo(0.05, 6);
  });
});

describe("isClockDriftBeyond", () => {
  it("does not read a midnight straddle as a day of drift", () => {
    const server = { day: 4, time: 0.02 };
    const client = { day: 3, time: TIME_PER_DAY - 0.02 };
    expect(isClockDriftBeyond(client, server, TIME_PER_DAY, 0.1)).toBe(false);
  });

  it("flags a real day of drift even when the times of day agree", () => {
    const server = { day: 4, time: 500 };
    const client = { day: 3, time: 500 };
    expect(isClockDriftBeyond(client, server, TIME_PER_DAY, 0.1)).toBe(true);
  });

  it("flags drift within a day past the threshold", () => {
    const server = { day: 4, time: 500.2 };
    const client = { day: 4, time: 500 };
    expect(isClockDriftBeyond(client, server, TIME_PER_DAY, 0.1)).toBe(true);
    expect(isClockDriftBeyond(client, server, TIME_PER_DAY, 0.3)).toBe(false);
  });
});

describe("clockStepSince", () => {
  it("takes the whole frame when no server time landed in it", () => {
    expect(clockStepSince(0.016, 100, -Infinity)).toBeCloseTo(0.016, 6);
  });

  it("takes only what came after a sync that landed mid-frame", () => {
    // A 1s frame (a throttled tab) whose STATS arrived 0.4s before it ended
    expect(clockStepSince(1, 100, 99.6)).toBeCloseTo(0.4, 6);
  });

  it("never steps backward", () => {
    expect(clockStepSince(0.016, 100, 100.5)).toBe(0);
  });

  it("keeps the clock on the server's track across a throttled tab", () => {
    // Frames once a second, STATS twice a second; the server is the truth
    let local = 0;
    let syncedAt = -Infinity;
    let lastFrame = 0;
    const corrections: number[] = [];
    for (let ms = 1; ms <= 10_000; ms++) {
      const now = ms / 1000;
      if (ms % 500 === 250) {
        corrections.push(now - local);
        if (Math.abs(now - local) > 0.1) {
          local = now;
          syncedAt = now;
        }
      }
      if (ms % 1000 === 0) {
        local += clockStepSince(now - lastFrame, now, syncedAt);
        syncedAt = -Infinity;
        lastFrame = now;
      }
    }
    // Lagging between frames is expected; running ahead is the double count
    expect(Math.min(...corrections)).toBeGreaterThan(-0.01);
  });
});
