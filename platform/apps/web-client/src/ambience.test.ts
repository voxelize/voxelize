import { describe, expect, it } from "vitest";

import { birdPhrase, bubbleBurst, CHIME_NOTES, nextChime, whaleCall } from "./ambience";

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

describe("ocean soundscape", () => {
  it("lets bubbles rise in short bursts", () => {
    const b = bubbleBurst(seq([0.3, 0.8, 0.1, 0.6, 0.9, 0.2]));
    expect(b.after).toBeGreaterThanOrEqual(1.5);
    expect(b.bubbles.length).toBeGreaterThanOrEqual(2);
    expect(b.bubbles.length).toBeLessThanOrEqual(7);
    for (const x of b.bubbles) {
      expect(x.length).toBeLessThan(0.11);
      expect(x.from).toBeGreaterThanOrEqual(300);
    }
  });

  it("hears whales only now and then, low and slow", () => {
    for (let s = 0; s < 20; s++) {
      const w = whaleCall(seq([s / 20, ((s * 7) % 20) / 20, ((s * 3) % 20) / 20]));
      expect(w.after).toBeGreaterThanOrEqual(25);
      expect(w.low).toBeLessThan(150);
      expect(w.high).toBeGreaterThan(w.low);
      expect(w.seconds).toBeGreaterThanOrEqual(3);
    }
  });
});
