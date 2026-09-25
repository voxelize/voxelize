import { describe, expect, it } from "vitest";

import {
  hashPhase,
  hashSeed,
  hashString,
  mulberry32,
  randomInt,
  seededRandom,
  unitOf,
} from "./random";
import { ParticleSystem } from "./system";
import type { ParticleConfig, ParticleWorld } from "./types";

describe("seeded randomness", () => {
  it("gives the same numbers for the same inputs, on every call", () => {
    expect(hashSeed(3, -7, 12, 400)).toBe(hashSeed(3, -7, 12, 400));
    expect(hashString("peer-a")).toBe(hashString("peer-a"));
    const a = seededRandom(hashSeed(1, 2, 3));
    const b = seededRandom(hashSeed(1, 2, 3));
    for (let i = 0; i < 32; i += 1) expect(a()).toBe(b());
  });

  it("pins its values, so every engine and build agrees", () => {
    // Integer-only math: these are the values on any machine. A change here
    // is a change to what every shared effect draws.
    expect(hashSeed(0)).toBe(hashSeed(0));
    expect(hashSeed(1, 2, 3)).toMatchInlineSnapshot(`923933900`);
    expect(hashString("peer-a")).toMatchInlineSnapshot(`3537961165`);
    const random = mulberry32(12345);
    expect([random(), random(), random()]).toMatchInlineSnapshot(`
      [
        0.9797282677609473,
        0.3067522644996643,
        0.484205421525985,
      ]
    `);
    expect(unitOf(99)).toMatchInlineSnapshot(`0.5501911893952638`);
  });

  it("tells inputs apart, including their order", () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(hashSeed(1, 2, 3)).not.toBe(hashSeed(1, 2, 4));
    expect(hashString("ab")).not.toBe(hashString("ba"));
  });

  it("spreads evenly over [0, 1)", () => {
    const random = seededRandom(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      buckets[Math.floor(value * 10)] += 1;
    }
    for (const count of buckets)
      expect(Math.abs(count - 2000)).toBeLessThan(200);
    let units = 0;
    for (let i = 0; i < 20000; i += 1) units += unitOf(hashSeed(i));
    expect(units / 20000).toBeCloseTo(0.5, 1);
  });

  it("gives an id one phase in its period", () => {
    expect(hashPhase("bot-1")).toBe(hashPhase("bot-1"));
    expect(hashPhase("bot-1")).not.toBe(hashPhase("bot-2"));
    const phase = hashPhase(42, 3);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(3);
  });

  it("draws integers across the whole inclusive range", () => {
    const random = seededRandom(3);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(randomInt(random, 1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });
});

/** Just enough world for a particle system to spawn into. */
function fakeWorld(): ParticleWorld {
  return {
    isInitialized: true,
    add: () => undefined,
    remove: () => undefined,
    getVoxelAt: () => 0,
    getBlockAt: () => null,
    getBlockFaceMaterial: () => undefined,
    getLightValuesAt: () => null,
    measureWaterColumnAt: () => null,
    registry: { blocksById: new Map() },
    chunkRenderer: {
      uniforms: {
        sunlightIntensity: { value: 1 },
        minLightLevel: { value: 0 },
        baseAmbient: { value: 0 },
      },
    },
    options: { maxLightLevel: 15 },
    physics: {} as ParticleWorld["physics"],
  };
}

const SCATTERED: ParticleConfig = {
  blend: "normal",
  lifetimeSec: { min: 0.5, max: 2 },
  size: { min: 0.05, max: 0.2 },
  sizeOverLife: { from: 1, to: 0 },
  alphaOverLife: { from: 1, to: 0 },
  palette: ["#ff0000", "#00ff00", "#0000ff", "#ffffff"],
  riseAccel: 0,
  dragPerSec: 0,
  turbulence: 0,
  spinRadPerSec: 1,
  sway: { speed: 0.2, frequencyHz: 1 },
};

/** Everything a spawn chose, read back from the layer. */
function spawned(system: ParticleSystem): number[][] {
  const layers = (system as unknown as { layers: Map<string, unknown> }).layers;
  const rows: number[][] = [];
  for (const layer of layers.values()) {
    const l = layer as Record<string, Float32Array> & { alive: number };
    for (let i = 0; i < l.alive; i += 1) {
      if (l.posY[i] < -500) continue; // the prewarm's hidden particle
      rows.push([
        l.posX[i],
        l.posY[i],
        l.posZ[i],
        l.velX[i],
        l.velY[i],
        l.velZ[i],
        l.life[i],
        l.sizeStart[i],
        l.colStartR[i],
        l.colStartG[i],
        l.colStartB[i],
        l.spinPhase[i],
        l.swayVelX[i],
        l.swayVelZ[i],
      ]);
    }
  }
  return rows;
}

describe("seeded particle spawns", () => {
  const burst = (system: ParticleSystem, seed: number) =>
    system.burst(SCATTERED, {
      position: { x: 10, y: 20, z: 30 },
      count: 12,
      speed: { min: 0.5, max: 2 },
      jitterRadius: 0.4,
      spreadRad: 0.6,
      direction: { x: 0, y: 1, z: 0 },
      random: seededRandom(seed),
    });

  it("scatters a seeded burst identically on two clients", () => {
    const a = new ParticleSystem(fakeWorld(), {
      capacityPerLayer: 64,
      maxFlashLights: 0,
    });
    const b = new ParticleSystem(fakeWorld(), {
      capacityPerLayer: 64,
      maxFlashLights: 0,
    });
    // Unseeded noise on one client must not disturb the seeded burst.
    a.burst(SCATTERED, {
      position: { x: 0, y: 0, z: 0 },
      count: 3,
      speed: { min: 0, max: 1 },
    });
    burst(a, 77);
    burst(b, 77);
    const rowsA = spawned(a).slice(3);
    const rowsB = spawned(b);
    expect(rowsA).toHaveLength(12);
    expect(rowsA).toEqual(rowsB);
  });

  it("scatters differently for a different seed", () => {
    const a = new ParticleSystem(fakeWorld(), {
      capacityPerLayer: 64,
      maxFlashLights: 0,
    });
    const b = new ParticleSystem(fakeWorld(), {
      capacityPerLayer: 64,
      maxFlashLights: 0,
    });
    burst(a, 77);
    burst(b, 78);
    expect(spawned(a)).not.toEqual(spawned(b));
  });
});
