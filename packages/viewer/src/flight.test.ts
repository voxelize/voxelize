import { describe, expect, it } from "vitest";

import {
  easeInOut,
  Flight,
  flightArc,
  flightDuration,
  interpolateOrbit,
  shortestTurn,
} from "./flight";
import type { Orbit } from "./pose";

const orbit = (x: number, distance: number, yaw = 0): Orbit => ({
  target: [x, 80, 0],
  distance,
  yaw,
  pitch: 0.6,
});

describe("easeInOut", () => {
  it("starts and ends at rest and never leaves its range", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(1e-3)).toBeLessThan(1e-8);
    expect(1 - easeInOut(1 - 1e-3)).toBeLessThan(1e-8);
    let last = 0;
    for (let i = 1; i <= 1000; i++) {
      const v = easeInOut(i / 1000);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(1);
      expect(easeInOut(1 - i / 1000)).toBeCloseTo(1 - v, 12);
      last = v;
    }
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe("interpolateOrbit", () => {
  it("lands exactly on both ends, arc or not", () => {
    const a = orbit(0, 400, 0.2);
    const b = orbit(300, 160, 1.4);
    expect(interpolateOrbit(a, b, 0, 2)).toEqual(a);
    const end = interpolateOrbit(a, b, 1, 2);
    expect(end.target).toEqual(b.target);
    expect(end.distance).toBeCloseTo(b.distance, 9);
    expect(end.yaw).toBeCloseTo(b.yaw, 12);
  });

  it("zooms geometrically and widens the middle by the arc", () => {
    const a = orbit(0, 400);
    const b = orbit(0, 100);
    expect(interpolateOrbit(a, b, 0.5).distance).toBeCloseTo(200, 9);
    expect(interpolateOrbit(a, b, 0.5, 1).distance).toBeCloseTo(400, 9);
  });

  it("turns the short way round", () => {
    expect(shortestTurn(3, -3)).toBeCloseTo(Math.PI * 2 - 6, 12);
    expect(shortestTurn(-3, 3)).toBeCloseTo(6 - Math.PI * 2, 12);
    const mid = interpolateOrbit(orbit(0, 100, 3), orbit(0, 100, -3), 0.5);
    expect(Math.cos(mid.yaw)).toBeCloseTo(-1, 2);
  });
});

describe("flight timing", () => {
  const timing = { min: 0.6, max: 1.2, spans: 16 };

  it("takes longer the farther it goes, within its bounds", () => {
    expect(flightDuration(0, 200, timing)).toBeCloseTo(0.6, 12);
    expect(flightDuration(200 * 16, 200, timing)).toBeCloseTo(1.2, 12);
    expect(flightDuration(200 * 1000, 200, timing)).toBeCloseTo(1.2, 12);
    let last = 0;
    for (const travel of [10, 100, 400, 1000, 4000]) {
      const d = flightDuration(travel, 200, timing);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
  });

  it("widens only for trips the frame cannot hold, up to its cap", () => {
    expect(flightArc(orbit(0, 200), orbit(150, 200), 2, 3)).toBe(0);
    expect(flightArc(orbit(0, 200), orbit(1600, 200), 2, 3)).toBeCloseTo(3, 9);
    expect(flightArc(orbit(0, 200), orbit(1600, 200), 2, 10)).toBeCloseTo(3, 9);
    expect(flightArc(orbit(0, 100), orbit(800, 100), 2, 10)).toBeCloseTo(3, 9);
  });
});

describe("Flight", () => {
  const make = () =>
    new Flight(orbit(0, 400), orbit(500, 100, 1), 0.9, (a, b, t) =>
      interpolateOrbit(a, b, t),
    );

  it("is in the same place at the same time at any frame rate", () => {
    const at = (fps: number) => {
      const flight = make();
      for (let i = 0; i < Math.round(0.5 * fps); i++) flight.step(1 / fps);
      return flight.current();
    };
    const slow = at(30);
    const fast = at(144);
    expect(fast.target[0]).toBeCloseTo(slow.target[0], 9);
    expect(fast.distance).toBeCloseTo(slow.distance, 9);
    expect(fast.yaw).toBeCloseTo(slow.yaw, 9);
  });

  it("lands on its end when its time is up, and stays where it was if stopped early", () => {
    const flight = make();
    for (let i = 0; i < 18; i++) flight.step(1 / 60);
    expect(flight.done).toBe(false);
    const stopped = flight.current();
    expect(flight.current()).toEqual(stopped);
    expect(stopped.target[0]).toBeGreaterThan(0);
    expect(stopped.target[0]).toBeLessThan(500);
    for (let i = 0; i < 60; i++) flight.step(1 / 60);
    expect(flight.done).toBe(true);
    expect(flight.current().target[0]).toBe(500);
  });
});
