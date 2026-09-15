import { AABB } from "@voxelize/aabb";
import { Engine } from "@voxelize/physics-engine";
import { describe, expect, it } from "vitest";

import { planAutoJump, AutoJumpParams } from "./auto-jump";

const BODY_WIDTH = 0.6;
const BODY_HEIGHT = 1.65;
const FLOOR_TOP = 1;
const LEDGE_X = 5;

const PARAMS: AutoJumpParams = {
  lookahead: 1.5,
  minHeight: 0.6,
  maxHeight: 1.2,
  apexHeight: 1.29,
  grazeRatio: 4,
};

type Box = { min: [number, number, number]; max: [number, number, number] };

/**
 * A flat floor with whatever world-space boxes the scene adds, served the
 * way the world serves the physics engine: every box already translated
 * into world space, looked up by the voxel it lives in.
 */
function createProbe(extras: Box[] = []) {
  return new Engine(
    (vx, vy, vz) => {
      const boxes: AABB[] = [];
      if (vy === FLOOR_TOP - 1) {
        boxes.push(new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1));
      }
      for (const { min, max } of extras) {
        const inX = vx >= Math.floor(min[0]) && vx < Math.ceil(max[0]);
        const inY = vy >= Math.floor(min[1]) && vy < Math.ceil(max[1]);
        const inZ = vz >= Math.floor(min[2]) && vz < Math.ceil(max[2]);
        if (inX && inY && inZ) {
          boxes.push(
            new AABB(
              Math.max(min[0], vx),
              Math.max(min[1], vy),
              Math.max(min[2], vz),
              Math.min(max[0], vx + 1),
              Math.min(max[1], vy + 1),
              Math.min(max[2], vz + 1),
            ),
          );
        }
      }
      return boxes;
    },
    () => false,
    () => [],
    () => 0,
    () => 0,
    {
      gravity: [0, -24.8, 0],
      minBounceImpulse: 0,
      airDrag: 0,
      fluidDrag: 0,
      fluidDensity: 1,
    },
  );
}

function bodyAt(x: number, z = 0.5) {
  return new AABB(
    x - BODY_WIDTH / 2,
    FLOOR_TOP,
    z - BODY_WIDTH / 2,
    x + BODY_WIDTH / 2,
    FLOOR_TOP + BODY_HEIGHT,
    z + BODY_WIDTH / 2,
  );
}

/** A ledge `height` tall whose face is at x = LEDGE_X, running to +x. */
function ledge(height: number, depth = 40): Box {
  return {
    min: [LEDGE_X, FLOOR_TOP, -20],
    max: [LEDGE_X + depth, FLOOR_TOP + height, 20],
  };
}

const PLUS_X: [number, number] = [1, 0];

describe("planAutoJump", () => {
  it("plans a hop at a one-block ledge inside the look-ahead", () => {
    const probe = createProbe([ledge(1)]);
    const body = bodyAt(4);

    const plan = planAutoJump(probe, body, PLUS_X, PARAMS);

    expect(plan).not.toBeNull();
    expect(plan?.height).toBeCloseTo(1, 9);
    expect(plan?.distance).toBeCloseTo(LEDGE_X - body.maxX, 6);
  });

  it("still hops when already standing against the ledge", () => {
    const probe = createProbe([ledge(1)]);
    const body = bodyAt(LEDGE_X - BODY_WIDTH / 2 - 1e-9);

    const plan = planAutoJump(probe, body, PLUS_X, PARAMS);

    expect(plan).not.toBeNull();
    expect(plan?.distance).toBeLessThan(1e-6);
  });

  it("waits while the ledge is still beyond the look-ahead", () => {
    const probe = createProbe([ledge(1)]);

    expect(planAutoJump(probe, bodyAt(2), PLUS_X, PARAMS)).toBeNull();
  });

  it("leaves rises no taller than a step to auto-stepping", () => {
    const probe = createProbe([ledge(0.5)]);

    expect(planAutoJump(probe, bodyAt(4), PLUS_X, PARAMS)).toBeNull();
  });

  it("does not attempt a wall taller than a jump clears", () => {
    const probe = createProbe([ledge(2)]);

    expect(planAutoJump(probe, bodyAt(4), PLUS_X, PARAMS)).toBeNull();
  });

  it("does not attempt a two-high wall whose lower block looks like a ledge", () => {
    // The hit block is one tall; the block on top of it is what blocks the
    // landing. voxelTop only sees the hit voxel, so this exercises the
    // raised landing sweep.
    const probe = createProbe([
      ledge(1),
      {
        min: [LEDGE_X, FLOOR_TOP + 1, -20],
        max: [LEDGE_X + 1, FLOOR_TOP + 2, 20],
      },
    ]);

    expect(planAutoJump(probe, bodyAt(4), PLUS_X, PARAMS)).toBeNull();
  });

  it("refuses to launch under a ceiling lower than the apex", () => {
    const ceilingBottom = FLOOR_TOP + BODY_HEIGHT + 0.5;
    const probe = createProbe([
      ledge(1),
      {
        min: [-20, ceilingBottom, -20],
        max: [LEDGE_X, ceilingBottom + 0.2, 20],
      },
    ]);

    expect(planAutoJump(probe, bodyAt(4), PLUS_X, PARAMS)).toBeNull();
  });

  it("refuses when the tread has no headroom for the body", () => {
    const treadCeiling = FLOOR_TOP + 1 + BODY_HEIGHT - 0.2;
    const probe = createProbe([
      ledge(1),
      {
        min: [LEDGE_X, treadCeiling, -20],
        max: [LEDGE_X + 3, treadCeiling + 0.2, 20],
      },
    ]);

    expect(planAutoJump(probe, bodyAt(4), PLUS_X, PARAMS)).toBeNull();
  });

  it("is not blocked by the next riser of a staircase one tread on", () => {
    const probe = createProbe([
      ledge(1, 1),
      {
        min: [LEDGE_X + 1, FLOOR_TOP, -20],
        max: [LEDGE_X + 2, FLOOR_TOP + 2, 20],
      },
    ]);

    const plan = planAutoJump(probe, bodyAt(4), PLUS_X, PARAMS);

    expect(plan).not.toBeNull();
    expect(plan?.height).toBeCloseTo(1, 9);
  });

  it("slides along a ledge it is only grazing, unless grazing is disabled", () => {
    const probe = createProbe([ledge(1)]);
    // Close enough that the shallow approach still reaches the face inside
    // the look-ahead; only the angle decides.
    const body = bodyAt(LEDGE_X - BODY_WIDTH / 2 - 0.05);
    const shallow = 5 * (Math.PI / 180);
    const grazing: [number, number] = [Math.sin(shallow), Math.cos(shallow)];

    expect(planAutoJump(probe, body, grazing, PARAMS)).toBeNull();
    expect(
      planAutoJump(probe, body, grazing, { ...PARAMS, grazeRatio: 0 }),
    ).not.toBeNull();
  });

  it("does nothing on open ground", () => {
    const probe = createProbe();

    expect(planAutoJump(probe, bodyAt(4), PLUS_X, PARAMS)).toBeNull();
  });
});
