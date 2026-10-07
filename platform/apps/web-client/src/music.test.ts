import { describe, expect, it } from "vitest";

import { compose, moodFor, pauseAfter } from "./music";

describe("music", () => {
  it("picks a mood from the dimension and the time of day", () => {
    expect(moodFor("overworld", 0.5)).toBe("day");
    expect(moodFor("overworld", 0.9)).toBe("night");
    expect(moodFor("overworld", 0.1)).toBe("night");
    expect(moodFor("underworld", 0.5)).toBe("underworld");
    expect(moodFor("sky", 0.9)).toBe("sky");
  });

  it("composes the same piece from the same seed, and another from another", () => {
    expect(compose(7, "day")).toEqual(compose(7, "day"));
    expect(compose(7, "day")).not.toEqual(compose(8, "day"));
  });

  it("writes calm, playable pieces", () => {
    for (const mood of ["day", "night", "underworld", "sky"] as const) {
      for (let seed = 1; seed < 40; seed++) {
        const piece = compose(seed, mood);
        expect(piece.seconds).toBeGreaterThan(20);
        expect(piece.seconds).toBeLessThan(60);
        const lead = piece.notes.filter((n) => n.voice === "lead");
        expect(lead.length).toBeGreaterThan(12);
        for (const n of piece.notes) {
          expect(n.at + n.length).toBeLessThanOrEqual(piece.seconds);
          expect(n.midi).toBeGreaterThanOrEqual(36);
          expect(n.midi).toBeLessThanOrEqual(96);
          expect(n.velocity).toBeLessThan(0.5);
        }
        // Melodies move mostly by small steps and end on the root.
        const leaps = lead.slice(1).filter((n, i) => Math.abs(n.midi - lead[i].midi) > 7).length;
        expect(leaps / lead.length).toBeLessThan(0.25);
        const roots = { day: 0, night: 9, underworld: 2, sky: 4 };
        expect(lead.at(-1)!.midi % 12).toBe(roots[mood]);
      }
    }
  });

  it("leaves minutes of silence between pieces", () => {
    expect(pauseAfter(() => 0)).toBe(90);
    expect(pauseAfter(() => 0.999)).toBeLessThan(240);
  });
});
