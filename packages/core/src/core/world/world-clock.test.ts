import { describe, expect, it } from "vitest";

import {
  advanceWorldClock,
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
