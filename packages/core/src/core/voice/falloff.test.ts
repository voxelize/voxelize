import { describe, expect, it } from "vitest";

import { voiceFalloffGain } from "./falloff";

const falloff = { fullVolumeDistance: 4, range: 32 };

describe("voiceFalloffGain", () => {
  it("is full volume up close and silent from the range on", () => {
    expect(voiceFalloffGain(0, falloff)).toBe(1);
    expect(voiceFalloffGain(4, falloff)).toBe(1);
    expect(voiceFalloffGain(32, falloff)).toBe(0);
    expect(voiceFalloffGain(500, falloff)).toBe(0);
  });

  it("halves when the distance doubles, before the closing fade", () => {
    expect(voiceFalloffGain(8, falloff)).toBeCloseTo(0.5, 6);
    expect(voiceFalloffGain(16, falloff)).toBeCloseTo(0.25, 6);
  });

  it("never gets louder with distance", () => {
    let previous = 1;
    for (let distance = 0; distance <= 40; distance += 0.05) {
      const gain = voiceFalloffGain(distance, falloff);
      expect(gain).toBeLessThanOrEqual(previous + 1e-9);
      expect(gain).toBeGreaterThanOrEqual(0);
      previous = gain;
    }
  });

  it("has no step anywhere, least of all at the edge", () => {
    // A tenth of a block is one frame of a sprint: the volume may not move
    // by more than a few percent of full in it.
    for (let distance = 0; distance <= 40; distance += 0.1) {
      const step = Math.abs(
        voiceFalloffGain(distance, falloff) -
          voiceFalloffGain(distance + 0.1, falloff),
      );
      expect(step).toBeLessThan(0.03);
    }
    // The last block before silence is already inaudible (under -50 dB).
    expect(voiceFalloffGain(31, falloff)).toBeLessThan(0.003);
  });

  it("is still clearly audible at half range", () => {
    const gain = voiceFalloffGain(16, falloff);
    expect(20 * Math.log10(gain)).toBeGreaterThan(-14);
  });

  it("takes a range shorter than the full-volume distance without a division by zero", () => {
    const tight = { fullVolumeDistance: 4, range: 3 };
    expect(voiceFalloffGain(2, tight)).toBe(1);
    expect(voiceFalloffGain(3, tight)).toBe(0);
  });

  it("is silent for a distance or a range that is not a number", () => {
    expect(voiceFalloffGain(Number.NaN, falloff)).toBe(0);
    expect(voiceFalloffGain(1, { fullVolumeDistance: 4, range: 0 })).toBe(0);
    expect(
      voiceFalloffGain(1, { fullVolumeDistance: 4, range: Number.NaN }),
    ).toBe(0);
  });
});
