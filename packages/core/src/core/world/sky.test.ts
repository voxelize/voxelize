import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getSunDiscDirection, getVisibleDiscDirection } from "./sky";

/**
 * Where the sky box's bottom-face centre (the painted sun) points after
 * `Sky.update` has spun the box: one full turn about Z per day.
 */
const paintedSunDirection = (timeOfDay: number): Vector3 => {
  const box = new Object3D();
  box.rotation.z = Math.PI * 2 * timeOfDay;
  box.updateMatrixWorld(true);
  return new Vector3(0, -1, 0).transformDirection(box.matrixWorld);
};

describe("getSunDiscDirection", () => {
  it("points where the sky box draws the sun, all day long", () => {
    const direction = new Vector3();
    for (let t = 0; t < 1; t += 1 / 96) {
      getSunDiscDirection(t, direction);
      expect(direction.distanceTo(paintedSunDirection(t))).toBeLessThan(1e-9);
      expect(direction.length()).toBeCloseTo(1, 9);
    }
  });

  it("rises along +X, culminates overhead, and sets along -X", () => {
    const direction = new Vector3();
    expect(
      getSunDiscDirection(0, direction).distanceTo(new Vector3(0, -1, 0)),
    ).toBeLessThan(1e-9);
    expect(
      getSunDiscDirection(0.25, direction).distanceTo(new Vector3(1, 0, 0)),
    ).toBeLessThan(1e-9);
    expect(
      getSunDiscDirection(0.5, direction).distanceTo(new Vector3(0, 1, 0)),
    ).toBeLessThan(1e-9);
    expect(
      getSunDiscDirection(0.75, direction).distanceTo(new Vector3(-1, 0, 0)),
    ).toBeLessThan(1e-9);
  });

  it("stays in the sun's plane: no sideways tilt, unlike the shading light", () => {
    const direction = new Vector3();
    for (let t = 0; t < 1; t += 1 / 96) {
      expect(getSunDiscDirection(t, direction).z).toBe(0);
    }
  });
});

describe("getVisibleDiscDirection", () => {
  it("is the sun while the sun is up", () => {
    const sun = new Vector3();
    const visible = new Vector3();
    for (let t = 0.26; t < 0.75; t += 1 / 96) {
      getSunDiscDirection(t, sun);
      getVisibleDiscDirection(t, visible);
      expect(visible.distanceTo(sun)).toBeLessThan(1e-12);
      expect(visible.y).toBeGreaterThan(0);
    }
  });

  it("is the moon — the sun's antipode, the box's top face — once it has set", () => {
    const sun = new Vector3();
    const visible = new Vector3();
    for (const t of [0.76, 0.85, 0.95, 0, 0.05, 0.15, 0.24]) {
      getSunDiscDirection(t, sun);
      getVisibleDiscDirection(t, visible);
      expect(visible.distanceTo(sun.clone().negate())).toBeLessThan(1e-12);
      expect(visible.y).toBeGreaterThan(0);
    }
  });

  it("never dips below the horizon, so a reflection always has a disc to find", () => {
    const visible = new Vector3();
    for (let t = 0; t < 1; t += 1 / 200) {
      getVisibleDiscDirection(t, visible);
      expect(visible.y).toBeGreaterThanOrEqual(0);
      expect(visible.length()).toBeCloseTo(1, 9);
    }
  });
});
