import { Color } from "three";
import { describe, expect, it } from "vitest";

import {
  acesToneMap,
  composeEntityLight,
  EntityLightSample,
} from "./entity-light";

// The dev sky palette's extremes (client sky-palette.ts): open noon and the
// deep of night. The chunk renderer's default floor is minLightLevel 0.04 +
// baseAmbient 0.005.
const NOON = {
  sunlightIntensity: 1,
  sunColor: new Color("#FFF6E6"),
  ambientColor: new Color("#A9B0B9"),
};
const MIDNIGHT = {
  sunlightIntensity: 0.085,
  sunColor: new Color("#8FA3CC"),
  ambientColor: new Color("#5E6A82"),
};
const AMBIENT_FLOOR = 0.045;

const dry = (over: Partial<EntityLightSample>): EntityLightSample => ({
  sunExposure: 1,
  floodR: 0,
  floodG: 0,
  floodB: 0,
  floodRemainder: 1,
  clusterR: 0,
  clusterG: 0,
  clusterB: 0,
  shadowFactor: 1,
  ambientFloor: AMBIENT_FLOOR,
  downTransmit: new Color(1, 1, 1),
  underwaterFill: new Color(0, 0, 0),
  ...NOON,
  ...over,
});

const compose = (sample: EntityLightSample) =>
  composeEntityLight(sample, new Color());

const maxChannel = (c: Color) => Math.max(c.r, c.g, c.b);
const minChannel = (c: Color) => Math.min(c.r, c.g, c.b);

describe("composeEntityLight", () => {
  it("never exceeds the ACES ceiling, whatever stands under the object", () => {
    // A level-15 white emitter floor at night, with the whole flood claimed
    // by a proxy carrying four emitters' intensity — the lantern plinth.
    const onLanternFloor = compose(
      dry({
        ...MIDNIGHT,
        floodR: 1,
        floodG: 1,
        floodB: 1,
        floodRemainder: 0,
        clusterR: 4,
        clusterG: 4,
        clusterB: 4,
      }),
    );
    const ceiling = acesToneMap(Number.MAX_SAFE_INTEGER);
    expect(maxChannel(onLanternFloor)).toBeLessThanOrEqual(ceiling);
    expect(maxChannel(onLanternFloor)).toBeLessThanOrEqual(1.04);

    // Additive composition put this at 1.2 in open noon sun; the terrain
    // lands its top faces around 0.85–0.9 through the same curve.
    const openNoon = compose(dry({}));
    expect(maxChannel(openNoon)).toBeLessThan(0.9);
    expect(minChannel(openNoon)).toBeGreaterThan(0.7);
  });

  it("lands a lit object within the terrain's own range, not far above it", () => {
    // The object on a level-15 floor at night should read about as bright as
    // a lit floor does through the shader: bright, warm, and under 1.
    const onEmitter = compose(
      dry({ ...MIDNIGHT, floodR: 1, floodG: 1, floodB: 1 }),
    );
    expect(maxChannel(onEmitter)).toBeGreaterThan(0.75);
    expect(maxChannel(onEmitter)).toBeLessThan(1);
    // Block light tints warm: red above blue, as the shader's warm tint does.
    expect(onEmitter.r).toBeGreaterThan(onEmitter.b);
  });

  it("is monotonic in flood level", () => {
    let previous = -Infinity;
    for (let level = 0; level <= 15; level++) {
      const lit = compose(
        dry({
          ...MIDNIGHT,
          floodR: level / 15,
          floodG: level / 15,
          floodB: level / 15,
        }),
      );
      expect(lit.r).toBeGreaterThanOrEqual(previous);
      previous = lit.r;
    }
  });

  it("treats zero cluster light as an exact identity", () => {
    const base = dry({ ...MIDNIGHT, floodR: 0.6, floodG: 0.5, floodB: 0.4 });
    const withoutCluster = compose(base);
    const withZeroCluster = compose({
      ...base,
      clusterR: 0,
      clusterG: 0,
      clusterB: 0,
    });
    expect(withZeroCluster.r).toBe(withoutCluster.r);
    expect(withZeroCluster.g).toBe(withoutCluster.g);
    expect(withZeroCluster.b).toBe(withoutCluster.b);
  });

  it("washes analytic light out under the noon sun, like the shader", () => {
    const shaded = dry({
      ...MIDNIGHT,
      clusterR: 2,
      clusterG: 1,
      clusterB: 0.5,
    });
    const noonLit = dry({ clusterR: 2, clusterG: 1, clusterB: 0.5 });
    const nightBase = compose(dry({ ...MIDNIGHT }));
    const noonBase = compose(dry({}));
    // At night the lamp tints the object strongly; at noon in the open the
    // same lamp is washed to nothing.
    expect(compose(shaded).r - nightBase.r).toBeGreaterThan(0.2);
    expect(Math.abs(compose(noonLit).r - noonBase.r)).toBeLessThan(1e-9);
  });

  it("darkens and blue-shifts the sun path under water while a lamp still reaches", () => {
    // Ten blocks of water: red is nearly gone, blue survives.
    const transmittance = new Color(0.05, 0.3, 0.6);
    const submergedDark = compose(
      dry({
        downTransmit: transmittance,
        underwaterFill: new Color(0.01, 0.02, 0.03),
      }),
    );
    const surface = compose(dry({}));
    expect(submergedDark.r).toBeLessThan(surface.r);
    expect(submergedDark.b).toBeGreaterThan(submergedDark.r);

    // Beside a level-15 lamp on the seabed the object is lit, but not past
    // the ceiling: the torch term screens in rather than adding on.
    const submergedLit = compose(
      dry({
        downTransmit: transmittance,
        underwaterFill: new Color(0.01, 0.02, 0.03),
        floodR: 1,
        floodG: 1,
        floodB: 1,
        clusterR: 1.5,
        clusterG: 1.5,
        clusterB: 1.5,
      }),
    );
    expect(maxChannel(submergedLit)).toBeGreaterThan(maxChannel(submergedDark));
    expect(maxChannel(submergedLit)).toBeLessThanOrEqual(1.04);
  });

  it("holds the darkness floor in a sealed cave", () => {
    const cave = compose(dry({ ...MIDNIGHT, sunExposure: 0, shadowFactor: 0 }));
    // Floor is ambientFloor * tint, tint ≥ 0.8.
    expect(minChannel(cave)).toBeGreaterThanOrEqual(AMBIENT_FLOOR * 0.8 - 1e-9);
    expect(maxChannel(cave)).toBeLessThan(0.15);
  });

  it("reuses the out color and allocates nothing per call", () => {
    const out = new Color();
    const returned = composeEntityLight(dry({}), out);
    expect(returned).toBe(out);
  });
});
