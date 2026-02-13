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
});
