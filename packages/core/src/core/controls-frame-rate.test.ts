import { AABB } from "@voxelize/aabb";
import { Engine } from "@voxelize/physics-engine";
import { PerspectiveCamera } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RigidControls, RigidControlsOptions } from "./controls";
import type { World } from "./world";

const GRAVITY = [0, -24.8, 0];
const AIR_DRAG = 0.1;
const FLUID_DRAG = 1.4;
const FLUID_DENSITY = 0.8;
/** Every hold below lasts a whole number of frames at each of these. */
const FRAME_RATES = [30, 60, 120];
const SETTLE_SECONDS = 2;

type Scene = "sky" | "floor" | "water" | "ladder";
type Held = Partial<RigidControls["movements"]>;
/** Keys held from `at` seconds into a run, for `for` seconds. */
type Press = { keys: Held; at: number; for: number };

/**
 * Open sky; a floor whose top is y = 1; water filling every voxel below
 * y = 200; or the floor with a ladder standing on it at x = 0, z = 0.
 */
function sceneEngine(scene: Scene) {
  const hasFloor = scene === "floor" || scene === "ladder";
  return new Engine(
    (vx, vy, vz) =>
      hasFloor && vy === 0
        ? [new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1)]
        : [],
    (_vx, vy) => scene === "water" && vy < 200,
    (vx, vy, vz) =>
      scene === "ladder" && vx === 0 && vz === 0 && vy > 0
        ? [new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1)]
        : [],
    () => 0,
    () => 0,
    {
      gravity: GRAVITY,
      minBounceImpulse: 0,
      airDrag: AIR_DRAG,
      fluidDrag: FLUID_DRAG,
      fluidDensity: FLUID_DENSITY,
    },
  );
}

let now = 0;

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A body driven the way a frame drives it: the controls' update (input,
 * walking, swimming, flight), then the world's physics step over the same
 * frame.
 */
function rig(
  scene: Scene,
  start: [number, number, number],
  options: Partial<RigidControlsOptions> = {},
) {
  const physics = sceneEngine(scene);
  const world = {
    physics,
    options: { gravity: GRAVITY, chunkSize: 16 },
    add: () => undefined,
    getBlockAt: () => null,
    getBlockAABBsAt: () => [],
  } as unknown as World;
  const controls = new RigidControls(
    new PerspectiveCamera(),
    {} as HTMLElement,
    world,
    { ...options, initialPosition: start, autoJump: false },
  );

  const run = (fps: number, seconds: number, presses: Press[] = []) => {
    const frames = Math.round(seconds * fps);
    for (let frame = 0; frame < frames; frame++) {
      const t = frame / fps;
      controls.resetMovements();
      for (const press of presses) {
        if (t >= press.at - 1e-9 && t < press.at + press.for - 1e-9) {
          Object.assign(controls.movements, press.keys);
        }
      }
      now += 1000 / fps;
      controls.update();
      physics.iterateBody(controls.body, 1 / fps, false);
    }
  };

  const position = () => controls.body.getPosition();
  const speed = () => {
    const [vx, , vz] = controls.body.velocity;
    return Math.hypot(vx, vz);
  };

  return { controls, run, position, speed };
}

/** `measure` run at every frame rate, keyed by frame rate. */
function atEveryFrameRate<T>(measure: (fps: number) => T) {
  return Object.fromEntries(
    FRAME_RATES.map((fps) => [fps, measure(fps)]),
  ) as Record<number, T>;
}

/** The largest relative difference from the reference rate's value. */
function spreadFrom120(values: Record<number, number>) {
  return Math.max(
    ...FRAME_RATES.map((fps) => Math.abs(values[fps] / values[120] - 1)),
  );
}

describe("RigidControls over the same wall time at 30, 60 and 120 fps", () => {
  it("climbs and descends as far for a held fly key, as tuned at the reference rate", () => {
    const hold = 0.4;
    const { flyImpulse, flyInertia, referenceFrameRate } = rig("sky", [0, 0, 0])
      .controls.options;
    // Thrust of flyImpulse per reference frame, against the fly inertia and
    // the air: the old once-per-frame impulse, read at the reference rate.
    const tuned =
      (hold * flyImpulse * referenceFrameRate) / (flyInertia + AIR_DRAG);

    for (const [key, sign] of [
      ["up", 1],
      ["down", -1],
    ] as const) {
      const climbs = atEveryFrameRate((fps) => {
        const body = rig("sky", [0, 100, 0]);
        body.controls.body.gravityMultiplier = 0;
        const y0 = body.position()[1];
        body.run(fps, hold + SETTLE_SECONDS, [
          { keys: { [key]: true }, at: 0, for: hold },
        ]);
        return sign * (body.position()[1] - y0);
      });

      for (const fps of FRAME_RATES) {
        expect(climbs[fps], `${key} at ${fps} fps`).toBeCloseTo(tuned, 1);
      }
      expect(spreadFrom120(climbs), key).toBeLessThan(1e-4);
    }
  });

  it("takes off as high: a jump, flight switched on mid-air, Space held on", () => {
    const takeoff = (fps: number, isHeld: boolean) => {
      const body = rig("floor", [0, 1, 0]);
      body.run(fps, 1);
      const y0 = body.position()[1];
      body.run(fps, 0.2, [{ keys: { up: true }, at: 0, for: 0.1 }]);
      body.controls.body.gravityMultiplier = 0;
      body.run(
        fps,
        0.1 + SETTLE_SECONDS,
        isHeld ? [{ keys: { up: true }, at: 0, for: 0.1 }] : [],
      );
      return body.position()[1] - y0;
    };
    const heights = atEveryFrameRate((fps) => takeoff(fps, true));
    const fromHold = atEveryFrameRate(
      (fps) => takeoff(fps, true) - takeoff(fps, false),
    );

    // What the held key adds is exact. The jump under it is integrated a
    // physics step at a time, first order in frame time like any jump, and
    // that is all that is left of the spread.
    expect(fromHold[120]).toBeGreaterThan(4);
    expect(spreadFrom120(fromHold)).toBeLessThan(1e-4);
    expect(spreadFrom120(heights)).toBeLessThan(0.03);
  });

  it("cruises at a steady speed, as far, in flight and on foot", () => {
    const cases: [string, Scene, Partial<RigidControlsOptions>][] = [
      ["flight", "sky", {}],
      ["flight with a strong push", "sky", { flyForce: 200, flySpeed: 12 }],
      ["walking", "floor", {}],
    ];

    for (const [name, scene, options] of cases) {
      const runs = atEveryFrameRate((fps) => {
        const body = rig(scene, [0, scene === "sky" ? 100 : 1, 0], options);
        if (scene === "sky") body.controls.body.gravityMultiplier = 0;
        body.run(fps, 1);
        const [x0, , z0] = body.position();
        const forward = { keys: { front: true }, at: 0, for: 1 };
        // Speeding up to the cruise and holding it, the speed never drops
        // from one frame to the next: no overshoot, no swinging about it.
        let drop = 0;
        let last = body.speed();
        for (let frame = 0; frame < fps * 1.5; frame++) {
          body.run(fps, 1 / fps, [forward]);
          drop = Math.max(drop, last - body.speed());
          last = body.speed();
        }
        body.run(fps, SETTLE_SECONDS);
        const [x, , z] = body.position();
        return { drop, distance: Math.hypot(x - x0, z - z0) };
      });

      for (const fps of FRAME_RATES) {
        expect(runs[fps].drop, `${name} at ${fps} fps`).toBeLessThan(1e-3);
      }
      const distances = atEveryFrameRate((fps) => runs[fps].distance);
      expect(spreadFrom120(distances), name).toBeLessThan(0.015);
    }
  });

  it("swims up as far, treading water or in the swim pose", () => {
    const treading = atEveryFrameRate((fps) => {
      const body = rig("water", [0, 100, 0]);
      body.run(fps, 1);
      const y0 = body.position()[1];
      body.run(fps, 1, [{ keys: { up: true }, at: 0, for: 1 }]);
      return body.position()[1] - y0;
    });
    const swimming = atEveryFrameRate((fps) => {
      const body = rig("water", [0, 100, 0]);
      body.run(fps, 1);
      body.run(fps, 0.1, [
        { keys: { front: true, sprint: true }, at: 0, for: 0.1 },
      ]);
      expect(body.controls.isSwimming).toBe(true);
      const y0 = body.position()[1];
      body.run(fps, 1, [{ keys: { up: true }, at: 0, for: 1 }]);
      return body.position()[1] - y0;
    });

    expect(treading[120]).toBeGreaterThan(5);
    expect(swimming[120]).toBeGreaterThan(5);
    // What is left is the water's own drag, applied once per physics step
    // after the push (first order in frame time).
    expect(spreadFrom120(treading)).toBeLessThan(0.01);
    expect(spreadFrom120(swimming)).toBeLessThan(0.03);
  });

  it("climbs a ladder as far", () => {
    const climbs = atEveryFrameRate((fps) => {
      const body = rig("ladder", [0, 30, 0]);
      body.run(fps, 0.5);
      const y0 = body.position()[1];
      body.run(fps, 1, [{ keys: { up: true }, at: 0, for: 1 }]);
      return body.position()[1] - y0;
    });

    expect(climbs[120]).toBeGreaterThan(4);
    expect(spreadFrom120(climbs)).toBeLessThan(0.02);
  });
});
