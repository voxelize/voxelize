import { AABB } from "@voxelize/aabb";
import { describe, expect, it } from "vitest";

import { Engine, RigidBody } from ".";

const BODY_WIDTH = 0.8;
const BODY_HEIGHT = 1.55;
const BODY_DEPTH = 0.8;
const MAX_SPEED = 6;
const MOVE_FORCE = 30;
const RESPONSIVENESS = 240;
const AIR_MOVE_MULTIPLIER = 0.7;
const RUNNING_FRICTION = 0.1;
const DELTA_TIME = 1 / 60;
const SIMULATION_FRAMES = 240;
const WALL_HEADING = (15 * Math.PI) / 180;
const WALL_X = 3;
const START_X = 2.6;
const FLOOR_Y = 0;
const BODY_MIN_Y = 1;
const WORLD_MIN = -20;
const WORLD_MAX = 80;
const STEP_HEIGHT = 0.5;
const POSITION_EPSILON = 1e-9;

function rotateY(vector: number[], radians: number) {
  const x = vector[0];
  const z = vector[2];
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);

  return [z * sin + x * cos, vector[1], z * cos - x * sin];
}

function createEngine() {
  return new Engine(
    (vx, vy, vz) => {
      const boxes: AABB[] = [];

      if (
        vy === FLOOR_Y &&
        vx >= WORLD_MIN &&
        vx <= WORLD_MAX &&
        vz >= WORLD_MIN &&
        vz <= WORLD_MAX
      ) {
        boxes.push(new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1));
      }

      if (
        vx === WALL_X &&
        vy >= BODY_MIN_Y &&
        vy <= BODY_MIN_Y + 3 &&
        vz >= WORLD_MIN &&
        vz <= WORLD_MAX
      ) {
        boxes.push(new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1));
      }

      return boxes;
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

function createBody(engine: Engine, stepHeight: number) {
  const body = engine.addBody({
    aabb: new AABB(
      START_X - BODY_WIDTH / 2,
      BODY_MIN_Y,
      -BODY_DEPTH / 2,
      START_X + BODY_WIDTH / 2,
      BODY_MIN_Y + BODY_HEIGHT,
      BODY_DEPTH / 2,
    ),
    stepHeight,
  });

  body.onStep = (newAABB) => {
    body.aabb = newAABB.clone();
  };

  return body;
}

function applyMovement(body: RigidBody) {
  const targetVelocity = rotateY([0, 0, MAX_SPEED], WALL_HEADING);
  const push = [
    targetVelocity[0] - body.velocity[0],
    0,
    targetVelocity[2] - body.velocity[2],
  ];
  const pushLength = Math.sqrt(push[0] ** 2 + push[2] ** 2);

  if (pushLength > 0) {
    push[0] /= pushLength;
    push[2] /= pushLength;

    let canPush = MOVE_FORCE;
    if (body.atRestY >= 0) {
      canPush *= AIR_MOVE_MULTIPLIER;
    }

    const pushAmount = RESPONSIVENESS * pushLength;
    if (canPush > pushAmount) {
      canPush = pushAmount;
    }

    body.applyForce([push[0] * canPush, 0, push[2] * canPush]);
  }

  body.friction = RUNNING_FRICTION;
}

function simulateWallSlide(stepHeight: number) {
  const engine = createEngine();
  const body = createBody(engine, stepHeight);

  for (let frame = 0; frame < SIMULATION_FRAMES; frame++) {
    applyMovement(body);
    engine.update(DELTA_TIME);
  }

  return body.getPosition();
}

describe("Engine", () => {
  it("does not add extra wall-slide movement through auto-step", () => {
    const withoutAutoStep = simulateWallSlide(0);
    const withAutoStep = simulateWallSlide(STEP_HEIGHT);

    expect(withAutoStep[2]).toBeLessThanOrEqual(
      withoutAutoStep[2] + POSITION_EPSILON,
    );
  });
});
