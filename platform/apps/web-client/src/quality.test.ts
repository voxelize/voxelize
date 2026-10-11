import { describe, expect, it } from "vitest";

import { AutoQuality, DOWN_AFTER, QUALITY, UP_AFTER } from "./quality";

const run = (q: AutoQuality, ms: number, seconds: number) => {
  for (let t = 0; t < seconds * 1000; t += ms) q.frame(ms);
  return q.level;
};

describe("automatic graphics quality", () => {
  it("steps down while frames are slow, one level at a time", () => {
    const q = new AutoQuality();
    expect(run(q, 33, DOWN_AFTER - 1)).toBe("high");
    expect(run(q, 33, 1.5)).toBe("medium");
    expect(run(q, 50, DOWN_AFTER + 0.5)).toBe("low");
    expect(run(q, 50, 10)).toBe("low");
  });

  it("climbs back after a long stretch of headroom", () => {
    const q = new AutoQuality();
    run(q, 40, 8);
    expect(q.level).toBe("low");
    expect(run(q, 10, UP_AFTER - 2)).toBe("low");
    expect(run(q, 10, 3)).toBe("medium");
  });

  it("ignores hitches and hidden-tab gaps", () => {
    const q = new AutoQuality();
    for (let i = 0; i < 50; i++) q.frame(900);
    expect(q.level).toBe("high");
    expect(run(q, 16, 30)).toBe("high");
  });

  it("draws low quality at a reduced resolution with fewer lights", () => {
    expect(QUALITY.low.pixelRatio).toBeLessThan(1);
    expect(QUALITY.high.lights).toBe("high");
  });
});
