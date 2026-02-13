import { describe, expect, it } from "vitest";

import { LightUtils } from "./light-utils";

describe("LightUtils parity", () => {
  it("masks inserted channels to 4 bits", () => {
    const sunlight = LightUtils.insertSunlight(0, 31);
    const red = LightUtils.insertRedLight(0, 31);
    const green = LightUtils.insertGreenLight(0, 31);
    const blue = LightUtils.insertBlueLight(0, 31);

    expect(LightUtils.extractSunlight(sunlight)).toBe(15);
    expect(LightUtils.extractRedLight(red)).toBe(15);
    expect(LightUtils.extractGreenLight(green)).toBe(15);
    expect(LightUtils.extractBlueLight(blue)).toBe(15);
  });

  it("rejects non-axis-aligned directions", () => {
    expect(() =>
      LightUtils.canEnterInto(
        [true, true, true, true, true, true],
        1,
        -1,
        1
      )
    ).toThrowError(Error);

    expect(() =>
      LightUtils.canEnter(
        [true, true, true, true, true, true],
        [true, true, true, true, true, true],
        1,
        -1,
        1
      )
    ).toThrowError(Error);
  });

  it("rejects fractional and oversized directions", () => {
    expect(() =>
      LightUtils.canEnterInto(
        [true, true, true, true, true, true],
        0.5,
        0.5,
        0
      )
    ).toThrowError(Error);

    expect(() =>
      LightUtils.canEnter(
        [true, true, true, true, true, true],
        [true, true, true, true, true, true],
        2,
        0,
        0
      )
    ).toThrowError(Error);
  });

  it("accepts valid single-axis directions", () => {
    expect(
      LightUtils.canEnterInto(
        [true, true, true, true, true, true],
        1,
        0,
        0
      )
    ).toBe(true);

    expect(
      LightUtils.canEnter(
        [true, true, true, true, true, true],
        [true, true, true, true, true, true],
        0,
        0,
        -1
      )
    ).toBe(true);
  });
});
