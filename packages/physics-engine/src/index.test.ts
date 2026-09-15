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
const WATER_SURFACE_Y = 40;
const SUBMERGED_MIN_Y = 20;
const BUOYANT_FLUID_DENSITY = 2;
const BUOYANCY_FRAMES = 60;

function rotateY(vector: number[], radians: number) {
  const x = vector[0];
  const z = vector[2];
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);

  return [z * sin + x * cos, vector[1], z * cos - x * sin];
}

type VoxelSource = (vx: number, vy: number, vz: number) => AABB[];

function createWorldEngine(getVoxel: VoxelSource) {
  return new Engine(
    getVoxel,
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

function inWorld(vx: number, vz: number) {
  return (
    vx >= WORLD_MIN && vx <= WORLD_MAX && vz >= WORLD_MIN && vz <= WORLD_MAX
  );
}

function fullBlock(vx: number, vy: number, vz: number) {
  return new AABB(vx, vy, vz, vx + 1, vy + 1, vz + 1);
}

function createEngine() {
  return createWorldEngine((vx, vy, vz) => {
    const boxes: AABB[] = [];

    if (vy === FLOOR_Y && inWorld(vx, vz)) {
      boxes.push(fullBlock(vx, vy, vz));
    }

    if (
      vx === WALL_X &&
      vy >= BODY_MIN_Y &&
      vy <= BODY_MIN_Y + 3 &&
      vz >= WORLD_MIN &&
      vz <= WORLD_MAX
    ) {
      boxes.push(fullBlock(vx, vy, vz));
    }

    return boxes;
  });
}

/**
 * Flat floor with a raised plateau starting at `x = WALL_X`. The plateau's
 * top sits `plateauHeight` blocks above the floor, and an optional thin
 * ceiling plate hangs over it (a world-space box inside the voxel above the
 * standing body) to prove the rise is measured, not assumed.
 */
function createPlateauEngine(plateauHeight: number, ceilingBottom?: number) {
  return createWorldEngine((vx, vy, vz) => {
    const boxes: AABB[] = [];
    if (!inWorld(vx, vz)) return boxes;

    if (vy === FLOOR_Y) boxes.push(fullBlock(vx, vy, vz));

    if (vx >= WALL_X) {
      const plateauTop = FLOOR_Y + 1 + plateauHeight;
      if (vy >= FLOOR_Y + 1 && vy < plateauTop) {
        boxes.push(
          new AABB(vx, vy, vz, vx + 1, Math.min(vy + 1, plateauTop), vz + 1),
        );
      }
    }

    if (ceilingBottom !== undefined && vy === Math.floor(ceilingBottom)) {
      boxes.push(
        new AABB(vx, ceilingBottom, vz, vx + 1, ceilingBottom + 0.2, vz + 1),
      );
    }

    return boxes;
  });
}

function createBody(
  engine: Engine,
  stepHeight: number,
  startX = START_X,
  stepGrazeRatio?: number,
) {
  const body = engine.addBody({
    aabb: new AABB(
      startX - BODY_WIDTH / 2,
      BODY_MIN_Y,
      -BODY_DEPTH / 2,
      startX + BODY_WIDTH / 2,
      BODY_MIN_Y + BODY_HEIGHT,
      BODY_DEPTH / 2,
    ),
    stepHeight,
    ...(stepGrazeRatio === undefined ? {} : { stepGrazeRatio }),
  });

  body.onStep = (newAABB) => {
    body.aabb = newAABB.clone();
  };

  return body;
}

function applyMovement(body: RigidBody, heading = WALL_HEADING) {
  const targetVelocity = rotateY([0, 0, MAX_SPEED], heading);
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

function simulateSubmerged(gravityMultiplier: number) {
  const engine = new Engine(
    () => [],
    (_vx, vy) => vy < WATER_SURFACE_Y,
    () => [],
    () => 0,
    () => 0,
    {
      gravity: [0, -28, 0],
      minBounceImpulse: 0,
      airDrag: 0,
      fluidDrag: 0,
      fluidDensity: BUOYANT_FLUID_DENSITY,
    },
  );

  const body = engine.addBody({
    aabb: new AABB(
      -BODY_WIDTH / 2,
      SUBMERGED_MIN_Y,
      -BODY_DEPTH / 2,
      BODY_WIDTH / 2,
      SUBMERGED_MIN_Y + BODY_HEIGHT,
      BODY_DEPTH / 2,
    ),
    gravityMultiplier,
  });

  for (let frame = 0; frame < BUOYANCY_FRAMES; frame++) {
    // Stand in for the controls driving the body every frame, so the
    // engine never parks it as asleep.
    body.markActive();
    engine.update(DELTA_TIME);
  }

  return body.getPosition()[1];
}

const STEP_START_X = 2;
const STEP_FRAMES = 120;
const HEADING_PLUS_X = Math.PI / 2;
const GRAZE_HEADING = (5 * Math.PI) / 180;
const FULL_STEP_HEIGHT = 1;
const HALF_STEP_HEIGHT = 0.5;
const LOW_CEILING_BOTTOM = 3.3;

function simulatePlateauApproach({
  plateauHeight,
  stepHeight,
  heading,
  ceilingBottom,
  stepGrazeRatio,
}: {
  plateauHeight: number;
  stepHeight: number;
  heading: number;
  ceilingBottom?: number;
  stepGrazeRatio?: number;
}) {
  const engine = createPlateauEngine(plateauHeight, ceilingBottom);
  const body = createBody(engine, stepHeight, STEP_START_X, stepGrazeRatio);
  const rises: number[] = [];

  body.onStep = (newAABB) => {
    rises.push(newAABB.minY - body.aabb.minY);
    body.aabb = newAABB.clone();
  };

  for (let frame = 0; frame < STEP_FRAMES; frame++) {
    applyMovement(body, heading);
    engine.update(DELTA_TIME);
  }

  return { body, rises };
}

describe("Engine", () => {
  it("does not add extra wall-slide movement through auto-step", () => {
    const withoutAutoStep = simulateWallSlide(0);
    const withAutoStep = simulateWallSlide(STEP_HEIGHT);

    expect(withAutoStep[2]).toBeLessThanOrEqual(
      withoutAutoStep[2] + POSITION_EPSILON,
    );
  });

  describe("auto-stepping", () => {
    it("climbs a full-block step in one tick and keeps its stride", () => {
      const { body, rises } = simulatePlateauApproach({
        plateauHeight: FULL_STEP_HEIGHT,
        stepHeight: FULL_STEP_HEIGHT,
        heading: HEADING_PLUS_X,
      });

      expect(rises).toHaveLength(1);
      expect(rises[0]).toBeCloseTo(FULL_STEP_HEIGHT, 6);
      expect(body.aabb.minY).toBeCloseTo(BODY_MIN_Y + FULL_STEP_HEIGHT, 6);
      // Well past the riser: the step did not eat the horizontal motion.
      expect(body.aabb.minX).toBeGreaterThan(WALL_X + 1);
      expect(body.velocity[0]).toBeGreaterThan(MAX_SPEED * 0.9);
    });

    it("neither climbs nor reports a step at a wall taller than stepHeight", () => {
      const { body, rises } = simulatePlateauApproach({
        plateauHeight: 2,
        stepHeight: FULL_STEP_HEIGHT,
        heading: HEADING_PLUS_X,
      });

      expect(rises).toHaveLength(0);
      expect(body.aabb.minY).toBeCloseTo(BODY_MIN_Y, 6);
      expect(body.aabb.maxX).toBeLessThanOrEqual(WALL_X + POSITION_EPSILON);
      expect(body.aabb.maxX).toBeGreaterThan(WALL_X - 1e-3);
    });

    it("rises only as far as the obstruction's top, so a half step fits under a low ceiling", () => {
      // A full-height trial rise would put the head through the ceiling
      // plate; measuring the ledge's actual top keeps the half step legal.
      const { body, rises } = simulatePlateauApproach({
        plateauHeight: HALF_STEP_HEIGHT,
        stepHeight: FULL_STEP_HEIGHT,
        heading: HEADING_PLUS_X,
        ceilingBottom: LOW_CEILING_BOTTOM,
      });

      expect(rises).toHaveLength(1);
      expect(rises[0]).toBeCloseTo(HALF_STEP_HEIGHT, 6);
      expect(body.aabb.minY).toBeCloseTo(BODY_MIN_Y + HALF_STEP_HEIGHT, 6);
      expect(body.aabb.minX).toBeGreaterThan(WALL_X + 1);
    });

    it("slides along a ledge it merely grazes instead of popping onto it", () => {
      const grazing = simulatePlateauApproach({
        plateauHeight: FULL_STEP_HEIGHT,
        stepHeight: FULL_STEP_HEIGHT,
        heading: GRAZE_HEADING,
      });

      expect(grazing.rises).toHaveLength(0);
      expect(grazing.body.aabb.minY).toBeCloseTo(BODY_MIN_Y, 6);
      expect(grazing.body.aabb.maxX).toBeLessThanOrEqual(
        WALL_X + POSITION_EPSILON,
      );
      expect(grazing.body.aabb.minZ).toBeGreaterThan(1);

      const committed = simulatePlateauApproach({
        plateauHeight: FULL_STEP_HEIGHT,
        stepHeight: FULL_STEP_HEIGHT,
        heading: GRAZE_HEADING,
        stepGrazeRatio: 0,
      });

      expect(committed.rises).toHaveLength(1);
      expect(committed.body.aabb.minY).toBeCloseTo(
        BODY_MIN_Y + FULL_STEP_HEIGHT,
        6,
      );
    });
  });

  it("holds a zero-gravity body in place underwater", () => {
    const startY = SUBMERGED_MIN_Y + BODY_HEIGHT / 2;

    expect(simulateSubmerged(1)).toBeGreaterThan(startY);
    expect(simulateSubmerged(0)).toBeCloseTo(startY);
  });
});
