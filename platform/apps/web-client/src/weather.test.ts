import { describe, expect, it } from "vitest";
import { effectLine, movement, tint } from "./weather";

describe("weather and effects", () => {
  it("darkens the sky in rain and more in thunder", () => {
    expect(tint({ kind: "clear", precipitation: "rain" })).toBe(0);
    expect(tint({ kind: "thunder", precipitation: "snow" })).toBeGreaterThan(tint({ kind: "rain", precipitation: "rain" }));
  });
  it("speeds, slows and lifts the body", () => {
    expect(movement([])).toEqual({ speed: 1, jump: 1 });
    expect(movement([{ kind: "speed", level: 1, seconds: 9 }]).speed).toBeCloseTo(1.4);
    expect(movement([{ kind: "slowness", level: 0, seconds: 9 }]).speed).toBeCloseTo(0.85);
    expect(movement([{ kind: "jump_boost", level: 0, seconds: 9 }]).jump).toBeCloseTo(1.25);
  });
  it("names effects with their level and time", () => {
    expect(effectLine({ kind: "strength", level: 1, seconds: 125 })).toBe("Strength II 2:05");
  });
});
