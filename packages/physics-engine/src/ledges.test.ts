import { AABB } from "@voxelize/aabb";
import { describe, expect, it } from "vitest";

import { Engine, RigidBody } from ".";

const BODY_WIDTH = 0.6;
const BODY_HEIGHT = 1.5;
const FLOOR_TOP = 1;
const STEP_HEIGHT = 0.6;
const MAX_SPEED = 5;
const MOVE_FORCE = 30;
const RESPONSIVENESS = 240;
const DELTA_TIME = 1 / 60;
const STAIR_X = 4;
const FLIGHT = 4;

type Facing = "front" | "back";

/**
 * A stair voxel as a game serves it: a half-slab tread across the whole
 * footprint and a full-height back over half of it. `front` puts the tread
 * on the -x side, so a body travelling +x meets the tread first; `back`
 * turns the block round, so it meets the tall half first.
 */
function stair(vx: number, vy: number, vz: number, facing: Facing) {
  const backMinX = facing === "front" ? vx + 0.5 : vx;
  return [
    new AABB(vx, vy, vz, vx + 1, vy + 0.5, vz + 1),
    new AABB(backMinX, vy + 0.5, vz, backMinX + 0.5, vy + 1, vz + 1),
  ];
}

/**
 * A flat floor and a flight of `FLIGHT` stairs climbing toward +x from
 * `x = STAIR_X`, solid underneath, with a plateau at the top.
 */
function createFlight(facing: Facing = "front") {
  return new Engine(
    (vx, vy, vz) => {
      if (vy < FLOOR_TOP) {
        return vy === FLOOR_TOP - 1
          ? [new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1)]
          : [];
      }
      const column = vx - STAIR_X;
      if (column < 0) return [];
      const stairY = FLOOR_TOP + Math.min(column, FLIGHT);
      if (vy < stairY) return [new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1)];
      if (vy === stairY && column < FLIGHT) return stair(vx, vy, vz, facing);
      return [];
    },
    () => false,
    () => [],
    () => 0,
    () => 0,
    {
      gravity: [0, -28, 0],
      minBounceImpulse: 0,
      airDrag: 0,
      fluidDrag: 0,
      fluidDensity: 1,
    },
  );
}

function boxAt(x: number, minY = FLOOR_TOP) {
  return new AABB(
    x - BODY_WIDTH / 2,
    minY,
    0.5 - BODY_WIDTH / 2,
    x + BODY_WIDTH / 2,
    minY + BODY_HEIGHT,
    0.5 + BODY_WIDTH / 2,
  );
}

function walkPlusX(body: RigidBody) {
  const gap = MAX_SPEED - body.velocity[0];
  body.applyForce([Math.min(MOVE_FORCE, RESPONSIVENESS * Math.abs(gap)), 0, 0]);
  body.friction = 0.1;
}

function climb(facing: Facing, frames: number) {
  const engine = createFlight(facing);
  const body = engine.addBody({ aabb: boxAt(2), stepHeight: STEP_HEIGHT });
  const rises: number[] = [];
  body.onStep = (newAABB) => {
    rises.push(newAABB.minY - body.aabb.minY);
    body.aabb = newAABB.clone();
  };

  for (let frame = 0; frame < frames; frame++) {
    walkPlusX(body);
    engine.update(DELTA_TIME);
  }

  return { body, rises };
}

describe("ledges inside a voxel", () => {
  it("walks up a flight of stairs half a block at a time, never needing a jump", () => {
    const { body, rises } = climb("front", 180);

    // Two rises per stair: onto the tread, then onto the back.
    expect(rises).toHaveLength(FLIGHT * 2);
    for (const rise of rises) expect(rise).toBeCloseTo(0.5, 6);
    expect(body.aabb.minY).toBeCloseTo(FLOOR_TOP + FLIGHT, 6);
    expect(body.aabb.minX).toBeGreaterThan(STAIR_X + FLIGHT);
    // The climb never cost the stride.
    expect(body.velocity[0]).toBeGreaterThan(MAX_SPEED * 0.9);
  });

  it("does not step a stair met from its tall side", () => {
    const { body, rises } = climb("back", 120);

    expect(rises).toHaveLength(0);
    expect(body.aabb.minY).toBeCloseTo(FLOOR_TOP, 6);
    expect(body.aabb.maxX).toBeLessThanOrEqual(STAIR_X + 1e-9);
  });

  it("reports the tread as the ledge from the front and the whole block from the back", () => {
    const lifted = boxAt(3, FLOOR_TOP + 1e-4);

    const front = createFlight("front").sweepObstruction(lifted, [1.5, 0, 0]);
    expect(front?.voxel).toEqual([STAIR_X, FLOOR_TOP, 0]);
    expect(front?.top).toBeCloseTo(FLOOR_TOP + 1, 9);
    expect(front?.ledge).toBeCloseTo(FLOOR_TOP + 0.5, 9);

    const back = createFlight("back").sweepObstruction(lifted, [1.5, 0, 0]);
    expect(back?.top).toBeCloseTo(FLOOR_TOP + 1, 9);
    expect(back?.ledge).toBeCloseTo(FLOOR_TOP + 1, 9);
  });

  it("reports the back as the ledge once the body stands on the tread", () => {
    const onTread = boxAt(STAIR_X + 0.1, FLOOR_TOP + 0.5 + 1e-4);

    const hit = createFlight("front").sweepObstruction(onTread, [1, 0, 0]);

    expect(hit?.voxel).toEqual([STAIR_X, FLOOR_TOP, 0]);
    expect(hit?.ledge).toBeCloseTo(FLOOR_TOP + 1, 9);
  });
});
