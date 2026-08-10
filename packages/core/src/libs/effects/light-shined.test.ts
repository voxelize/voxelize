import { Color, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { World } from "../../core";

import { LightShined } from "./light-shined";

const makeWorld = () => {
  const counter = { raycasts: 0 };
  const world = {
    chunkRenderer: {
      uniforms: {
        sunlightIntensity: { value: 1 },
        minLightLevel: { value: 0.1 },
        baseAmbient: { value: 0.1 },
      },
      shaderLightingUniforms: {
        sunColor: { value: new Color(1, 1, 1) },
        ambientColor: { value: new Color(0.4, 0.4, 0.4) },
        sunDirection: { value: new Vector3(0, 1, 0) },
        shadowStrength: { value: 1 },
      },
    } as World["chunkRenderer"],
    options: { maxLightLevel: 15 } as World["options"],
    csmRenderer: {} as World["csmRenderer"],
    localLights: {
      options: { maskKnee: 0.25 } as World["localLights"]["options"],
      blockLightOwnership: 0,
      queryLocalLights: () => undefined,
    } as Partial<World["localLights"]> as World["localLights"],
    getLightValuesAt: () => ({ red: 0, green: 0, blue: 0, sunlight: 15 }),
    getVoxelWaterloggedAt: () => false,
    getBlockAt: () => null,
    raycastVoxels: () => {
      counter.raycasts += 1;
      return null;
    },
  };
  return { counter, world: world as Partial<World> as World };
};

const makeShinedObject = (shined: LightShined) => {
  const parent = new Object3D();
  const obj = new Object3D();
  parent.add(obj);
  shined.add(obj);
  return obj;
};

describe("LightShined sampling cadence", () => {
  it("samples a stationary object on its interval, not every frame", () => {
    const { counter, world } = makeWorld();
    const shined = new LightShined(world, { sampleIntervalFrames: 4 });
    makeShinedObject(shined);

    shined.update();
    const afterFirst = counter.raycasts;
    expect(afterFirst).toBe(1);

    for (let i = 0; i < 12; i++) shined.update();

    // Twelve further frames at an interval of four allow three refreshes.
    expect(counter.raycasts - afterFirst).toBe(3);
  });

  it("staggers objects so samples spread across frames", () => {
    const { counter, world } = makeWorld();
    const shined = new LightShined(world, { sampleIntervalFrames: 4 });
    for (let i = 0; i < 4; i++) makeShinedObject(shined);

    shined.update();
    counter.raycasts = 0;

    const perFrame: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = counter.raycasts;
      shined.update();
      perFrame.push(counter.raycasts - before);
    }

    // Four objects on a four-frame interval with distinct phases: exactly
    // one refresh lands per frame instead of four every fourth frame.
    expect(perFrame).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("resamples immediately when the object actually moves", () => {
    const { counter, world } = makeWorld();
    const shined = new LightShined(world, {
      sampleIntervalFrames: 60,
      resampleDistance: 0.5,
    });
    const obj = makeShinedObject(shined);

    shined.update();
    counter.raycasts = 0;

    obj.position.set(0.1, 0, 0);
    shined.update();
    expect(counter.raycasts).toBe(0);

    obj.position.set(3, 0, 0);
    shined.update();
    expect(counter.raycasts).toBe(1);
  });
});
