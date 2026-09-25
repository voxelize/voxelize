import { describe, expect, it } from "vitest";

import {
  AIRLIGHT_SLOTS,
  type AirlightInput,
  LocalLightAirlight,
} from "./airlight";
import { LightClusterGrid } from "./clustering";
import { LightSourceRegistry } from "./registry";
import { LocalLightDescriptor, LocalLightStats } from "./types";

const FRAME_MS = 16;

const lamp = (overrides: Partial<LocalLightDescriptor> = {}) =>
  ({
    shape: "point",
    color: [1, 0.8, 0.5],
    intensity: 1,
    range: 12,
    isStatic: true,
    shadowPolicy: "none",
    ...overrides,
  }) as LocalLightDescriptor;

const stats = () =>
  ({
    registered: 0,
    candidates: 0,
    clustered: 0,
    cellsOverflowed: 0,
    selectMs: 0,
    packMs: 0,
    scanMs: 0,
    selectMsPeak: 0,
    packMsPeak: 0,
    scanMsPeak: 0,
    sectionsPendingScan: 0,
    selectionChurn: 0,
    fadingSlots: 0,
    fadingLights: 0,
    highResolution: 0,
    gridTextureUploads: 0,
    dataTextureUploads: 0,
    shadowed: 0,
    shadowFacesRendered: 0,
    shadowFacesStatic: 0,
    shadowFacesDynamic: 0,
    shadowScheduleMs: 0,
    shadowScheduleMsPeak: 0,
    shadowInvalidations: 0,
    atlasEvictions: 0,
    atlasOccupancy: 0,
    shadowCacheHitRate: 1,
    ledgerUnitsCsm: 0,
    ledgerUnitsLocal: 0,
    atlasBytes: 0,
  }) as LocalLightStats;

const setup = (lights: [number, number, number, number?][]) => {
  const registry = new LightSourceRegistry(64);
  const handles = lights.map(([x, y, z, intensity]) =>
    registry.add(lamp({ intensity: intensity ?? 1 }), x, y, z),
  );
  const grid = new LightClusterGrid(registry, {
    gridCellSize: 8,
    gridDims: [24, 12, 24],
    maxClusteredLights: 192,
    maxLightsPerCell: 4,
    analyticRadius: 64,
    selectionHysteresis: 1.2,
    maskKnee: 2 / 15,
    fluidSpecularStrength: 1,
  });
  const airlight = new LocalLightAirlight({
    fadeMs: 320,
    strength: 0.0022,
    lightsPerTier: {
      ultra: 8,
      high: 6,
      medium: 3,
      low: 0,
      potato: 0,
      off: 0,
    },
  });
  const s = stats();
  let now = 0;
  const blocked = new Set<number>();
  const frame = (
    camera: [number, number, number],
    extra: Partial<AirlightInput> = {},
  ) => {
    now += FRAME_MS;
    grid.update(camera[0], camera[1], camera[2], s, now);
    airlight.update({
      grid,
      registry,
      cameraX: camera[0],
      cameraY: camera[1],
      cameraZ: camera[2],
      nowMs: now,
      tier: "high",
      daylight: 0,
      skyExposure: 0,
      submersion: 0,
      isVisible: (_fx, _fy, _fz, tx, ty, tz) => {
        for (const h of blocked) {
          const i = registry.resolve(h);
          if (
            registry.positions[i * 3] === Math.fround(tx) &&
            registry.positions[i * 3 + 1] === Math.fround(ty) &&
            registry.positions[i * 3 + 2] === Math.fround(tz)
          ) {
            return false;
          }
        }
        return true;
      },
      ...extra,
    });
  };
  /** Red channel written for a light, 0 when it is not in the set. */
  const redOf = (x: number) => {
    const u = airlight.uniforms;
    for (let k = 0; k < u.count.value; k++) {
      if (Math.abs(u.positions.value[k].x - x) < 1e-3) {
        return u.colors.value[k].x;
      }
    }
    return 0;
  };
  /** Red the air glow carries for a light (membership x line of sight). */
  const airOf = (x: number) => {
    const u = airlight.uniforms;
    for (let k = 0; k < u.count.value; k++) {
      if (Math.abs(u.positions.value[k].x - x) < 1e-3) {
        return u.colors.value[k].x * u.seen.value[k];
      }
    }
    return 0;
  };
  return { registry, handles, airlight, frame, redOf, airOf, blocked };
};

describe("LocalLightAirlight", () => {
  it("keeps its own tier table, so tuning one set leaves the defaults alone", () => {
    const a = new LocalLightAirlight();
    a.options.lightsPerTier.high = 1;
    expect(new LocalLightAirlight().options.lightsPerTier.high).toBe(2);
  });

  it("fades a light into the air instead of switching it on", () => {
    const { frame, redOf } = setup([[4, 4, 4]]);
    // Dimmer and fade both ease from zero.
    let previous = 0;
    let largestStep = 0;
    for (let n = 0; n < 150; n++) {
      frame([0, 4, 0]);
      largestStep = Math.max(largestStep, redOf(4) - previous);
      previous = redOf(4);
    }
    expect(previous).toBeGreaterThan(0.8);
    expect(largestStep).toBeLessThan(0.12);
  });

  it("keeps the steady set at the tier's size, strongest first", () => {
    const lights: [number, number, number][] = [];
    for (let i = 0; i < 10; i++) lights.push([i * 3, 4, 0]);
    const { frame, airlight } = setup(lights);
    for (let n = 0; n < 80; n++) frame([0, 4, 0]);
    // high: 6 steady lights; the nearest six (x = 0..15).
    expect(airlight.uniforms.count.value).toBe(6);
    const xs = airlight.uniforms.positions.value
      .slice(0, 6)
      .map((p) => Math.round(p.x) || 0)
      .sort((a, b) => a - b);
    expect(xs).toEqual([0, 3, 6, 9, 12, 15]);
    expect(airlight.size).toBeLessThanOrEqual(AIRLIGHT_SLOTS);
  });

  it("does not trade an incumbent for a marginally stronger challenger", () => {
    const lights: [number, number, number, number][] = [
      [10, 4, 0, 1],
      [0, 4, 10.3, 1],
    ];
    const { frame, redOf, airlight } = setup(lights);
    airlight.options.lightsPerTier.high = 1;
    for (let n = 0; n < 40; n++) frame([0, 4, 0]);
    expect(redOf(10)).toBeGreaterThan(0);
    // Walk a little toward the challenger: its score passes the incumbent's
    // by a few percent, well inside the hysteresis.
    for (let n = 0; n < 40; n++) frame([0, 4, 0.4]);
    expect(redOf(10)).toBeGreaterThan(0.5);
    airlight.options.lightsPerTier.high = 6;
  });

  it("fades the air glow of a light it can no longer see, and back when it can", () => {
    const { frame, redOf, airOf, blocked, handles } = setup([[4, 4, 4]]);
    for (let n = 0; n < 150; n++) frame([0, 4, 0]);
    expect(airOf(4)).toBeGreaterThan(0.8);
    blocked.add(handles[0]);
    const trace: number[] = [];
    for (let n = 0; n < 40; n++) {
      frame([0, 4, 0]);
      trace.push(airOf(4));
    }
    expect(trace[trace.length - 1]).toBe(0);
    for (let n = 1; n < trace.length; n++) {
      expect(trace[n - 1] - trace[n]).toBeLessThan(0.12);
    }
    // Room fill is a property of the surface, not of the camera's line of
    // sight: the member stays, at full energy.
    expect(redOf(4)).toBeGreaterThan(0.8);
    blocked.clear();
    for (let n = 0; n < 150; n++) frame([0, 4, 0]);
    expect(airOf(4)).toBeGreaterThan(0.8);
  });

  it("empties the air in daylight while the room fill keeps its lights", () => {
    const { frame, airlight, redOf, airOf } = setup([[4, 4, 4]]);
    for (let n = 0; n < 60; n++) frame([0, 4, 0]);
    expect(airlight.uniforms.airActive.value).toBe(1);
    let previous = airOf(4);
    let largestStep = 0;
    for (let n = 0; n < 400; n++) {
      frame([0, 4, 0], { daylight: 1, skyExposure: 1 });
      largestStep = Math.max(largestStep, previous - airOf(4));
      previous = airOf(4);
    }
    expect(largestStep).toBeLessThan(0.12);
    expect(airOf(4)).toBe(0);
    expect(airlight.uniforms.airActive.value).toBe(0);
    expect(airlight.uniforms.count.value).toBe(1);
    expect(redOf(4)).toBeGreaterThan(0.8);
  });

  it("keeps no air glow under open sky at night by default", () => {
    const { frame, airOf, redOf } = setup([[4, 4, 4]]);
    for (let n = 0; n < 150; n++) frame([0, 4, 0], { skyExposure: 1 });
    expect(airOf(4)).toBe(0);
    expect(redOf(4)).toBeGreaterThan(0.8);
  });

  it("has no air glow at strength 0, so the effect skips the screen", () => {
    const { frame, airlight } = setup([[4, 4, 4]]);
    airlight.uniforms.strength.value = 0;
    for (let n = 0; n < 60; n++) frame([0, 4, 0]);
    expect(airlight.uniforms.airActive.value).toBe(0);
    expect(airlight.uniforms.count.value).toBe(1);
  });
});
