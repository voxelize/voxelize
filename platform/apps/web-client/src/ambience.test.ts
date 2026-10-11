import { describe, expect, it } from "vitest";

import { birdPhrase, CHIME_NOTES, nextChime } from "./ambience";

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("paradise soundscape", () => {
  it("rings chimes now and then, from a scale that always sounds well", () => {
    for (let s = 0; s < 50; s++) {
      const r = seq([s / 50, ((s * 7) % 50) / 50, ((s * 13) % 50) / 50]);
      const c = nextChime(r);
      expect(c.after).toBeGreaterThanOrEqual(2.5);
      expect(c.after).toBeLessThan(8.6);
      expect(CHIME_NOTES).toContain(c.midi);
      expect(c.strength).toBeLessThan(0.61);
    }
  });

  it("sings short bird phrases of quick, high chirps", () => {
    const p = birdPhrase(seq([0.5, 0.9, 0.2, 0.7, 0.4, 0.1, 0.8]));
    expect(p.chirps.length).toBeGreaterThanOrEqual(2);
    expect(p.chirps.length).toBeLessThanOrEqual(5);
    for (const c of p.chirps) {
      expect(c.length).toBeLessThan(0.14);
      expect(Math.min(c.from, c.to)).toBeGreaterThan(2000);
    }
    // In order, never overlapping.
    for (let i = 1; i < p.chirps.length; i++) expect(p.chirps[i].at).toBeGreaterThan(p.chirps[i - 1].at + p.chirps[i - 1].length);
  });
});
