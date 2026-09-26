import { describe, expect, it } from "vitest";

import { computeFogRange } from "./fog-range";

const BASE = {
  chunkSize: 16,
  renderRadius: 8,
  fogNearRenderRatio: 0.45,
  fogFarRenderRatio: 0.78,
};

describe("computeFogRange", () => {
  it("derives fog from render radius when no override is set", () => {
    expect(computeFogRange({ ...BASE, fogDistance: null })).toEqual({
      near: 8 * 16 * 0.45,
      far: 8 * 16 * 0.78,
    });
  });

  it("derives fog from render radius when the override is undefined", () => {
    expect(computeFogRange(BASE)).toEqual({
      near: 8 * 16 * 0.45,
      far: 8 * 16 * 0.78,
    });
  });

  it("moves the radius-derived fog when render radius changes (the bug being fixed)", () => {
    const small = computeFogRange({
      ...BASE,
      renderRadius: 8,
      fogDistance: null,
    });
    const big = computeFogRange({
      ...BASE,
      renderRadius: 20,
      fogDistance: null,
    });
    expect(big.far).toBeGreaterThan(small.far);
  });

  it("holds a fixed fog distance across render radius changes", () => {
    const atRadius8 = computeFogRange({
      ...BASE,
      renderRadius: 8,
      fogDistance: 100,
    });
    const atRadius20 = computeFogRange({
      ...BASE,
      renderRadius: 20,
      fogDistance: 100,
    });
    expect(atRadius8.far).toBe(100);
    expect(atRadius20.far).toBe(100);
    expect(atRadius8).toEqual(atRadius20);
  });

  it("keeps the near/far ratio when a fixed distance is under the render distance", () => {
    const range = computeFogRange({ ...BASE, fogDistance: 100 });
    expect(range.far).toBe(100);
    expect(range.near).toBeCloseTo(100 * (0.45 / 0.78));
  });

  it("clamps a fixed fog distance down to the render distance, never out past it", () => {
    // renderRadius 4 * chunkSize 16 = 64 blocks loaded; asking for fog at
    // 500 blocks would fog into unloaded void, so it clamps to 64.
    const range = computeFogRange({
      ...BASE,
      renderRadius: 4,
      fogDistance: 500,
    });
    expect(range.far).toBe(64);
  });

  it("never returns a negative fog distance", () => {
    const range = computeFogRange({ ...BASE, fogDistance: -10 });
    expect(range.far).toBe(0);
    expect(range.near).toBe(0);
  });

  it("falls back to a zero near distance if fogFarRenderRatio is zero", () => {
    const range = computeFogRange({
      ...BASE,
      fogFarRenderRatio: 0,
      fogDistance: 100,
    });
    expect(range.near).toBe(0);
    expect(range.far).toBe(100);
  });
});
