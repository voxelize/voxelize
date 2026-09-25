import { describe, expect, it } from "vitest";

import {
  IDLE_DEEP_DRAW_INTERVAL_MS,
  IDLE_DRAW_INTERVAL_MS,
  describeDrawInterval,
  idleDrawIntervalFor,
  resolveIdleDeepAfterMs,
  resolveIdleDrawAfterMs,
} from "./idle-draw";

describe("idleDrawIntervalFor", () => {
  const rules = { drawAfterMs: 20_000, deepAfterMs: 120_000 };

  it("draws every frame until the first idle cap", () => {
    expect(idleDrawIntervalFor(0, rules)).toBeNull();
    expect(idleDrawIntervalFor(19_999, rules)).toBeNull();
  });

  it("caps at a few frames a second, then a frame every few seconds", () => {
    expect(idleDrawIntervalFor(20_000, rules)).toBe(IDLE_DRAW_INTERVAL_MS);
    expect(idleDrawIntervalFor(119_999, rules)).toBe(IDLE_DRAW_INTERVAL_MS);
    expect(idleDrawIntervalFor(120_000, rules)).toBe(
      IDLE_DEEP_DRAW_INTERVAL_MS,
    );
  });

  it("turns off with its knobs", () => {
    expect(
      idleDrawIntervalFor(600_000, { ...rules, drawAfterMs: 0 }),
    ).toBeNull();
    expect(idleDrawIntervalFor(600_000, { ...rules, deepAfterMs: 0 })).toBe(
      IDLE_DRAW_INTERVAL_MS,
    );
  });

  it("never goes deep before the first cap would start", () => {
    expect(
      idleDrawIntervalFor(60_000, { drawAfterMs: 90_000, deepAfterMs: 30_000 }),
    ).toBeNull();
  });
});

describe("idle draw knobs", () => {
  it("read their env vars and fall back on garbage", () => {
    expect(resolveIdleDrawAfterMs({})).toBe(20_000);
    expect(resolveIdleDeepAfterMs({ AGENT_IDLE_DEEP_AFTER_MS: "0" })).toBe(0);
    expect(resolveIdleDeepAfterMs({ AGENT_IDLE_DEEP_AFTER_MS: "soon" })).toBe(
      120_000,
    );
  });

  it("describe the cap as a frame rate", () => {
    expect(describeDrawInterval(null)).toBe("every frame");
    expect(describeDrawInterval(500)).toBe("2fps");
    expect(describeDrawInterval(5_000)).toBe("0.2fps");
  });
});
