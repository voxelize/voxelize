import { describe, expect, it } from "vitest";

import { DEFAULTS, sanitize } from "./settings";

describe("settings", () => {
  it("fall back to defaults for missing or broken storage", () => {
    expect(sanitize(null)).toEqual(DEFAULTS);
    expect(sanitize("nonsense")).toEqual(DEFAULTS);
  });

  it("clamp out-of-range and ignore wrong types", () => {
    const s = sanitize({ fov: 500, sensitivity: -3, renderDistance: "far", volume: 0.3, invertY: true });
    expect(s.fov).toBe(110);
    expect(s.sensitivity).toBe(20);
    expect(s.renderDistance).toBe(DEFAULTS.renderDistance);
    expect(s.volume).toBe(0.3);
    expect(s.invertY).toBe(true);
  });
});
