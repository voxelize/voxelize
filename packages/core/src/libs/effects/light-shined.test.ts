import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import type { World } from "../../core";

import { LightShined } from "./light-shined";

type LightValues = {
  red: number;
  green: number;
  blue: number;
  sunlight: number;
};
type LocalLightOut = {
  color: [number, number, number];
  count: number;
  claim: number;
  windowFade: number;
};

const makeWorld = (
  over: {
    light?: LightValues;
    sunlightIntensity?: number;
    localLight?: { color: [number, number, number]; claim: number };
  } = {},
) => {
  const counter = { raycasts: 0 };
  const world = {
    chunkRenderer: {
      uniforms: {
        sunlightIntensity: { value: over.sunlightIntensity ?? 1 },
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
      blockLightOwnership: over.localLight ? 1 : 0,
      queryLocalLights: (_pos: Vector3, out: LocalLightOut) => {
        if (!over.localLight) return;
        out.color[0] = over.localLight.color[0];
        out.color[1] = over.localLight.color[1];
        out.color[2] = over.localLight.color[2];
        out.count = 1;
        out.claim = over.localLight.claim;
        out.windowFade = 1;
      },
    } as Partial<World["localLights"]> as World["localLights"],
    getLightValuesAt: () =>
      over.light ?? { red: 0, green: 0, blue: 0, sunlight: 15 },
    measureWaterColumnAt: () => null,
    raycastVoxels: () => {
      counter.raycasts += 1;
      return null;
    },
  };
  return { counter, world: world as Partial<World> as World };
};

/** The multiplier a mesh under the effect ends up with after one update. */
const litColorOf = (shined: LightShined) => {
  const parent = new Object3D();
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  parent.add(mesh);
  shined.add(mesh);
  shined.update();
  const uniforms = mesh.userData.lightUniforms as { value: Color }[];
  expect(uniforms).toHaveLength(1);
  return uniforms[0].value;
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

describe("LightShined brightness", () => {
  it("keeps an object in open noon sun at the terrain's brightness, under 1", () => {
    const { world } = makeWorld();
    const lit = litColorOf(new LightShined(world));
    // The additive composition put this at ~1.2; the shader's own curve
    // lands open sun around 0.8–0.9.
    expect(Math.max(lit.r, lit.g, lit.b)).toBeLessThan(0.95);
    expect(Math.min(lit.r, lit.g, lit.b)).toBeGreaterThan(0.6);
  });

  it("does not blow out on a level-15 emitter under a bank of analytic lights", () => {
    // The lantern plinth at night: full flood, a lit-floor proxy carrying
    // four emitters' intensity in the cell, and the flood fully claimed.
    const { world } = makeWorld({
      light: { red: 15, green: 15, blue: 15, sunlight: 15 },
      sunlightIntensity: 0.085,
      localLight: { color: [4, 4, 4], claim: 4 },
    });
    const lit = litColorOf(new LightShined(world));
    expect(Math.max(lit.r, lit.g, lit.b)).toBeLessThanOrEqual(1);
    expect(Math.max(lit.r, lit.g, lit.b)).toBeGreaterThan(0.7);
  });

  it("honours a lower explicit brightness cap", () => {
    const { world } = makeWorld({
      light: { red: 15, green: 15, blue: 15, sunlight: 15 },
    });
    const lit = litColorOf(new LightShined(world, { maxBrightness: 0.5 }));
    expect(Math.max(lit.r, lit.g, lit.b)).toBeLessThanOrEqual(0.5);
  });
});

describe("LightShined change detection", () => {
  const lightUniformsOf = (obj: Object3D) =>
    (obj.userData.lightUniforms ?? []) as { value: Color }[];

  it("sets up equipment added after registration, before its first draw", () => {
    const { world } = makeWorld();
    const shined = new LightShined(world);
    const parent = new Object3D();
    const character = new Object3D();
    parent.add(character);
    shined.add(character);
    shined.update();
    expect(lightUniformsOf(character)).toHaveLength(0);

    const hat = new Object3D();
    const brim = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    hat.add(brim);
    character.add(hat);
    expect(brim.material.userData.lightEffectSetup).toBe(true);
    expect(lightUniformsOf(character)).toHaveLength(1);
    expect(character.userData.justChanged).toBe(true);

    // A grandchild added under the late child is covered too.
    const feather = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    hat.add(feather);
    expect(lightUniformsOf(character)).toHaveLength(2);
  });

  it("leaves children arrays and materials as plain objects", () => {
    const { world } = makeWorld();
    const shined = new LightShined(world);
    const parent = new Object3D();
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(new BoxGeometry(), material);
    const children = mesh.children;
    parent.add(mesh);
    shined.add(mesh);
    expect(mesh.material).toBe(material);
    expect(mesh.children).toBe(children);
  });

  it("stops setting up a subtree once removed from the shined object", () => {
    const { world } = makeWorld();
    const shined = new LightShined(world);
    const parent = new Object3D();
    const character = new Object3D();
    const cape = new Object3D();
    character.add(cape);
    parent.add(character);
    shined.add(character);
    character.remove(cape);
    cape.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    expect(lightUniformsOf(character)).toHaveLength(0);

    shined.remove(character);
    character.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    expect(lightUniformsOf(character)).toHaveLength(0);
  });

  it("keeps the old Proxy path available for A/B measurement", () => {
    const { world } = makeWorld();
    const shined = new LightShined(world, { useProxyChangeDetection: true });
    const parent = new Object3D();
    const character = new Object3D();
    parent.add(character);
    shined.add(character);
    character.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    expect(lightUniformsOf(character)).toHaveLength(1);
  });
});

describe("LightShined detached subtrees", () => {
  /**
   * The entity manager releases an entity by detaching its root, so a lit
   * character inside it keeps a parent. With `skipDetached` the effect stops
   * paying for it (perf audit fix 1); without it the old cost remains.
   */
  const releasedCharacter = (shined: LightShined) => {
    const scene = new Scene();
    const entity = new Object3D();
    const character = new Object3D();
    entity.add(character);
    scene.add(entity);
    shined.add(character);
    return { scene, entity, character };
  };

  it("skips a lit child once its root is detached from the scene", () => {
    const { counter, world } = makeWorld();
    const shined = new LightShined(world, {
      sampleIntervalFrames: 1,
      skipDetached: true,
    });
    const { scene, entity } = releasedCharacter(shined);
    shined.update();
    expect(counter.raycasts).toBe(1);

    scene.remove(entity);
    for (let i = 0; i < 5; i++) shined.update();
    expect(counter.raycasts).toBe(1);

    // Streamed back in under a scene: lit again.
    scene.add(entity);
    shined.update();
    expect(counter.raycasts).toBe(2);
  });

  it("keeps the old per-frame cost when off", () => {
    const { counter, world } = makeWorld();
    const shined = new LightShined(world, { sampleIntervalFrames: 1 });
    const { scene, entity } = releasedCharacter(shined);
    scene.remove(entity);
    for (let i = 0; i < 5; i++) shined.update();
    expect(counter.raycasts).toBe(5);
  });
});
