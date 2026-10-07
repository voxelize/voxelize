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

  it("keep a known colour vision aid and repair key maps", () => {
    const s = sanitize({ colourVision: "tritanopia", keys: { forward: "ArrowUp", back: 3 } });
    expect(s.colourVision).toBe("tritanopia");
    expect(s.keys.forward).toBe("ArrowUp");
    expect(s.keys.back).toBe("KeyS");
    expect(sanitize({ colourVision: "sepia" }).colourVision).toBe("normal");
  });
});
