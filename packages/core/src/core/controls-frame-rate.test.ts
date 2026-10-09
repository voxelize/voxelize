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

/** Water over a bed whose top is y = 1, up to `surface`, for z >= 0; a bank
 * whose top is `bankTop` for z < 0, ahead of a body facing forward (-z). */
type Pool = { surface: number; bankTop: number };
type Scene = "sky" | "floor" | "water" | "ladder" | Pool;
const POOL_BED_TOP = 1;
type Held = Partial<RigidControls["movements"]>;
/** Keys held from `at` seconds into a run, for `for` seconds. */
type Press = { keys: Held; at: number; for: number };

/**
 * Open sky; a floor whose top is y = 1; water filling every voxel below
 * y = 200; or the floor with a ladder standing on it at x = 0, z = 0.
 */
function sceneEngine(scene: Scene) {
  const engineOptions = {
    gravity: GRAVITY,
    minBounceImpulse: 0,
    airDrag: AIR_DRAG,
    fluidDrag: FLUID_DRAG,
    fluidDensity: FLUID_DENSITY,
  };
  if (typeof scene === "object") {
    const { surface, bankTop } = scene;
    return new Engine(
      (vx, vy, vz) =>
        vy < (vz < 0 ? bankTop : POOL_BED_TOP)
          ? [new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1)]
          : [],
      (_vx, vy, vz) => vz >= 0 && vy >= POOL_BED_TOP && vy < surface,
      () => [],
      () => 0,
      () => 0,
      engineOptions,
    );
  }
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
    engineOptions,
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
    { autoJump: false, ...options, initialPosition: start },
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
  /** Stands the body with its feet at `feet`. */
  const place = ([x, y, z]: [number, number, number]) =>
    controls.body.setPosition([x, y + controls.body.aabb.height / 2, z]);
  const feet = () => controls.body.aabb.minY;
  const speed = () => {
    const [vx, , vz] = controls.body.velocity;
    return Math.hypot(vx, vz);
  };

  return { controls, run, position, speed, place, feet };
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

/**
 * A jump from rest on the floor with Space held `holdSeconds`: how high it
 * peaks, and how fast it rises `atSeconds` after the press.
 */
function jumpFromFloor(
  fps: number,
  holdSeconds: number,
  atSeconds: number,
  options: Partial<RigidControlsOptions> = {},
) {
  const body = rig("floor", [0, 1, 0], options);
  body.run(fps, 1);
  const y0 = body.position()[1];
  let apex = 0;
  let speedAt = Number.NaN;
  for (let frame = 0; frame < fps * 1.5; frame++) {
    const isHeld = frame / fps < holdSeconds - 1e-9;
    body.run(
      fps,
      1 / fps,
      isHeld ? [{ keys: { up: true }, at: 0, for: 1 }] : [],
    );
    apex = Math.max(apex, body.position()[1] - y0);
    if (Math.abs((frame + 1) / fps - atSeconds) < 1e-9) {
      speedAt = body.controls.body.velocity[1];
    }
  }
  return { apex, speedAt };
}

describe("RigidControls jumps and ladders at 30, 60 and 120 fps", () => {
  it("pushes a held jump for jumpTime milliseconds and no longer", () => {
    const { jumpForce, jumpTime } = rig("sky", [0, 0, 0]).controls.options;
    for (const fps of FRAME_RATES) {
      // Held to well past the landing apex, let go just past the push
      // window, and not pushed at all.
      const held = jumpFromFloor(fps, 0.5, 0.2);
      const letGo = jumpFromFloor(fps, 0.1, 0.2);
      const unpushed = jumpFromFloor(fps, 0.5, 0.2, { jumpForce: 0 });

      expect(held.apex, `${fps} fps`).toBeCloseTo(letGo.apex, 9);
      expect(held.speedAt - unpushed.speedAt, `${fps} fps`).toBeCloseTo(
        (jumpForce * jumpTime) / 1000,
        2,
      );
    }
  });

  it("lifts a held jump as high as a jumpForce of 1 held through the whole rise did", () => {
    for (const fps of FRAME_RATES) {
      const held = jumpFromFloor(fps, 0.5, 0.2);
      const wholeRise = jumpFromFloor(fps, 0.5, 0.2, {
        jumpForce: 1,
        jumpTime: 1000,
      });
      expect(Math.abs(held.apex - wholeRise.apex), `${fps} fps`).toBeLessThan(
        0.01,
      );
    }
  });

  it("climbs a ladder from rest at its foot", () => {
    for (const fps of FRAME_RATES) {
      const body = rig("ladder", [0, 1, 0]);
      // Long enough standing still on the floor for the body to fall asleep.
      body.run(fps, 1);
      const y0 = body.position()[1];
      body.run(fps, 1, [{ keys: { up: true }, at: 0, for: 1 }]);
      expect(body.position()[1] - y0, `${fps} fps`).toBeGreaterThan(4);
    }
  });
});

/** A body in `pool` with its feet at `feet`; `nearBank` stands it with its
 * front a hair short of the bank. */
function inPool(
  pool: Pool,
  feet: [number, number, number],
  options: Partial<RigidControlsOptions> = {},
) {
  const body = rig(pool, [0, 0, 0], options);
  body.place(feet);
  return body;
}

const nearBank = (body: ReturnType<typeof inPool>, back = 0) =>
  body.controls.body.aabb.depth / 2 + 0.02 + back;

/** Past the bank's edge with its feet on (or above) its top. */
const isOnBank = (body: ReturnType<typeof inPool>, bankTop: number) =>
  body.position()[2] < 0 && body.feet() >= bankTop - 0.01;

describe("RigidControls getting out of water at 30, 60 and 120 fps", () => {
  it("swims up from a deep bed with Space held once the jump has spent its push", () => {
    const pool = { surface: POOL_BED_TOP + 3, bankTop: POOL_BED_TOP + 3 };
    for (const fps of FRAME_RATES) {
      const body = inPool(pool, [0.5, POOL_BED_TOP, 3.5]);
      body.run(fps, 0.5);
      let highest = body.feet();
      for (let frame = 0; frame < fps * 2; frame++) {
        body.run(fps, 1 / fps, [{ keys: { up: true }, at: 0, for: 1 }]);
        highest = Math.max(highest, body.feet());
      }
      // A jump from this bed alone peaks about 1.6 up; swimming on reaches
      // the surface, three up.
      expect(highest - POOL_BED_TOP, `${fps} fps`).toBeGreaterThan(3);
    }
  });

  it("climbs out onto a bank a block above the surface with Space and forward", () => {
    const pool = { surface: POOL_BED_TOP + 3, bankTop: POOL_BED_TOP + 4 };
    for (const fps of FRAME_RATES) {
      const treading = inPool(pool, [0.5, POOL_BED_TOP + 0.5, 0]);
      treading.place([0.5, POOL_BED_TOP + 0.5, nearBank(treading)]);
      treading.run(fps, 1.5, [{ keys: { up: true }, at: 0, for: 1.5 }]);
      treading.run(fps, 2, [
        { keys: { up: true, front: true }, at: 0, for: 2 },
      ]);
      expect(isOnBank(treading, pool.bankTop), `treading, ${fps} fps`).toBe(
        true,
      );

      const swimming = inPool(pool, [0.5, POOL_BED_TOP + 1.2, 4]);
      swimming.run(fps, 0.3, [
        { keys: { front: true, sprint: true }, at: 0, for: 0.3 },
      ]);
      expect(swimming.controls.isSwimming, `${fps} fps`).toBe(true);
      swimming.run(fps, 2.5, [
        { keys: { front: true, sprint: true, up: true }, at: 0, for: 2.5 },
      ]);
      expect(isOnBank(swimming, pool.bankTop), `swimming, ${fps} fps`).toBe(
        true,
      );
    }
  });

  it("walks or jumps out of shallow water onto a bank at the surface", () => {
    const pool = { surface: POOL_BED_TOP + 1, bankTop: POOL_BED_TOP + 1 };
    for (const fps of FRAME_RATES) {
      for (const keys of [{ front: true }, { front: true, up: true }]) {
        const wading = inPool(pool, [0.5, POOL_BED_TOP, 0], { autoJump: true });
        wading.place([0.5, POOL_BED_TOP, nearBank(wading, 1)]);
        wading.run(fps, 0.5);
        wading.run(fps, 2, [{ keys, at: 0, for: 2 }]);
        expect(
          isOnBank(wading, pool.bankTop),
          `${JSON.stringify(keys)}, ${fps} fps`,
        ).toBe(true);
      }
    }
  });
});
