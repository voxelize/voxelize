import { describe, expect, it } from "vitest";

import { levelFromRms, levelToDb, rms, VoiceLevelMeter } from "./level";

describe("voice level", () => {
  it("measures a block's RMS", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 6);
    const sine = Float32Array.from({ length: 960 }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / 48000),
    );
    expect(rms(sine)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("puts loudness on an even decibel scale", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(0.001)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
    expect(levelFromRms(2)).toBe(1);
    // -30 dBFS is the middle of a -60..0 scale.
    expect(levelFromRms(10 ** (-30 / 20))).toBeCloseTo(0.5, 6);
    expect(levelToDb(0.5)).toBeCloseTo(-30, 6);
    expect(levelToDb(levelFromRms(0.1))).toBeCloseTo(-20, 6);
  });

  it("rises at once and falls slowly", () => {
    const meter = new VoiceLevelMeter(2);
    expect(meter.push(0.8, 20)).toBe(0.8);
    // 20 ms of silence: down by 2/s * 0.02 s.
    expect(meter.push(0, 20)).toBeCloseTo(0.76, 6);
    expect(meter.push(0.9, 20)).toBe(0.9);
    expect(meter.decay(1000)).toBe(0);
  });
});
