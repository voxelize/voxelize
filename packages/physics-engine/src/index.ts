import { AABB } from "@voxelize/aabb";
import raycast from "@voxelize/raycast";

import { RigidBody } from "./rigid-body";
import { sweep } from "./sweep";

function approxEquals(a: number, b: number) {
  return Math.abs(a - b) < 1e-5;
}

export type BodyOptions = {
  aabb: AABB;
  mass: number;
  friction: number;
  restitution: number;
  gravityMultiplier: number;
  onStep: (newAABB: AABB, resting: number[]) => void;
  onCollide: (impacts?: number[]) => void;
  stepHeight: number;
};

export type EngineOptions = {
  gravity: number[];
  minBounceImpulse: number;
  airDrag: number;
  fluidDrag: number;
  fluidDensity: number;
};

export class Engine {
  public bodies: RigidBody[] = [];

  public static EPSILON = 1e-10;

  constructor(
    private getVoxel: (vx: number, vy: number, vz: number) => AABB[],
    private testFluid: (vx: number, vy: number, vz: number) => boolean,
    private getClimbableAABBs: (vx: number, vy: number, vz: number) => AABB[],
    private getVoxelStage: (vx: number, vy: number, vz: number) => number,
    private getFluidFlowForce: (vx: number, vy: number, vz: number) => number,
    public options: EngineOptions
  ) {}

  addBody = (options: Partial<BodyOptions>) => {
    const defaultOptions = {
      aabb: new AABB(0, 0, 0, 1, 1, 1),
      mass: 1,
      friction: 1,
      restitution: 0,
      gravityMultiplier: 1,
      stepHeight: 0.0,
    };

    const {
      aabb,
      mass,
      friction,
      restitution,
      gravityMultiplier,
      stepHeight,
      onStep,
      onCollide,
    } = {
      ...defaultOptions,
      ...options,
    };

    const b = new RigidBody(
      aabb,
      mass,
      friction,
      restitution,
      gravityMultiplier,
      stepHeight,
      onStep,
      onCollide
    );
    this.bodies.push(b);
    return b;
  };

  removeBody = (body: RigidBody) => {
    const i = this.bodies.indexOf(body);
    if (i < 0) return undefined;
    this.bodies.splice(i, 1);
  };

  update = (dt: number) => {
    const noGravity = approxEquals(
      0,
      this.options.gravity[0] ** 2 +
        this.options.gravity[1] ** 2 +
        this.options.gravity[2] ** 2
    );
    this.bodies.forEach((b) => this.iterateBody(b, dt, noGravity));
  };

  iterateBody = (body: RigidBody, dt: number, noGravity: boolean) => {
    const oldResting = [...body.resting];

    // treat bodies with <= mass as static
    if (body.mass <= 0) {
      body.velocity = [0, 0, 0];
      body.forces = [0, 0, 0];
      body.impulses = [0, 0, 0];
      return;
    }

    // skip bodies if static or no velocity/forces/impulses
    const localNoGrav = noGravity || body.gravityMultiplier === 0;
    if (this.isBodyAsleep(body, dt, localNoGrav)) return;
    body.sleepFrameCount--;

    // check if under water, if so apply buoyancy and drag forces
    this.applyFluidForces(body);

    // check if on climbable block, if so reduce gravity
    this.applyClimbableForces(body);

    // semi-implicit Euler integration

    // a = f/m + gravity*gravityMultiplier
    // zero gravity when on climbable - controls handle vertical movement
    const effectiveGravityMult = body.onClimbable ? 0 : body.gravityMultiplier;
    const a = [
      body.forces[0] / body.mass +
        this.options.gravity[0] * effectiveGravityMult,
      body.forces[1] / body.mass +
        this.options.gravity[1] * effectiveGravityMult,
      body.forces[2] / body.mass +
        this.options.gravity[2] * effectiveGravityMult,
    ];

    // dv = i/m + a*dt
    // v1 = v0 + dv
    const dv = [
      body.impulses[0] / body.mass + a[0] * dt,
      body.impulses[1] / body.mass + a[1] * dt,
      body.impulses[2] / body.mass + a[2] * dt,
    ];
    body.velocity = [
      body.velocity[0] + dv[0],
      body.velocity[1] + dv[1],
      body.velocity[2] + dv[2],
    ];

    // apply friction based on change in velocity this frame
    if (body.friction) {
      this.applyFrictionByAxis(0, body, dv);
      this.applyFrictionByAxis(1, body, dv);
      this.applyFrictionByAxis(2, body, dv);
    }

    // linear air or fluid friction - effectively v *= drag
    // body settings override global settings
    let drag = body.airDrag >= 0 ? body.airDrag : this.options.airDrag;
    if (body.inFluid) {
      drag = body.fluidDrag >= 0 ? body.fluidDrag : this.options.fluidDrag;
      drag *= 1 - (1 - body.ratioInFluid) ** 2;
    }
    const mult = Math.max(1 - (drag * dt) / body.mass, 0);
    body.velocity = [
      body.velocity[0] * mult,
      body.velocity[1] * mult,
      body.velocity[2] * mult,
    ];

    // x1-x0 = v1*dt
    const dx = [
      body.velocity[0] * dt,
      body.velocity[1] * dt,
      body.velocity[2] * dt,
    ];

    // clear forces and impulses for next timestep
    body.forces = [0, 0, 0];
    body.impulses = [0, 0, 0];

    // cache old position for use in autostepping
    const tmpBox: AABB = body.aabb.clone();

    // sweeps aabb along dx and accounts for collisions
    this.processCollisions(body.aabb, dx, body.resting);

    this.tryCliffHanging(body, tmpBox, dx);

    if (body.stepHeight > 0) {
      const autoStepBox = body.aabb.clone();
      this.tryAutoStepping(body, autoStepBox, dx);
    }

    // Collision impacts. b.resting shows which axes had collisions:
    const impacts = [0, 0, 0];

    for (let i = 0; i < 3; ++i) {
      if (body.resting[i]) {
        // count impact only if wasn't collided last frame
        if (!oldResting[i]) impacts[i] = -body.velocity[i];
        body.velocity[i] = 0;
      }
    }

    const mag = Math.sqrt(impacts[0] ** 2 + impacts[1] ** 2 + impacts[2] ** 2);
    if (mag > 0.001) {
      // epsilon
      // send collision event - allows client to optionally change
      // body's restitution depending on what terrain it hit
      // event argument is impulse J = m * dv
      impacts[0] = impacts[0] * body.mass;
      impacts[1] = impacts[1] * body.mass;
      impacts[2] = impacts[2] * body.mass;

      if (body.onCollide) body.onCollide(impacts);

      // bounce depending on restitution and minBounceImpulse
      if (body.restitution > 0 && mag > this.options.minBounceImpulse) {
        impacts[0] = impacts[0] * body.restitution;
        impacts[1] = impacts[1] * body.restitution;
        impacts[2] = impacts[2] * body.restitution;
        body.applyImpulse(impacts);
      }
    }

    // sleep check
    const vsq =
      body.velocity[0] ** 2 + body.velocity[1] ** 2 + body.velocity[2] ** 2;
    if (vsq > 1e-5) body.markActive();
  };

  tryCliffHanging = (body: RigidBody, oldBox: AABB, dx: number[]): boolean => {
    if (!body.isCliffHanging || !body.resting[1]) return false;

    const walls: AABB[] = [];

    const footY =
      Math.abs(oldBox.minY - Math.floor(oldBox.minY)) <= Engine.EPSILON
        ? Math.floor(oldBox.minY)
        : oldBox.minY;
    const pxpz = [oldBox.maxX, footY, oldBox.maxZ];
    const pxnz = [oldBox.maxX, footY, oldBox.minZ];
    const nxpz = [oldBox.minX, footY, oldBox.maxZ];
    const nxnz = [oldBox.minX, footY, oldBox.minZ];

    const stepHeight = body.stepHeight > 0 ? body.stepHeight : 0.5;
    const isDangerousDropNxPz = this.isDangerousDrop(nxpz, stepHeight);
    const isDangerousDropNxNz = this.isDangerousDrop(nxnz, stepHeight);
    const isDangerousDropPxPz = this.isDangerousDrop(pxpz, stepHeight);
    const isDangerousDropPxNz = this.isDangerousDrop(pxnz, stepHeight);

    const bodyXWidth = oldBox.maxX - oldBox.minX;
    const bodyZWidth = oldBox.maxZ - oldBox.minZ;
    const clingingFactorInVoxel = 0.2; // 0.2 voxels of clinging

    if (dx[0] > 0 && (isDangerousDropPxPz || isDangerousDropPxNz)) {
      const foundX = this.findCliffX(oldBox, footY, true);
      if (foundX !== null) {
        const minClingFactor = Math.min(
          clingingFactorInVoxel,
          foundX - oldBox.minX
        );
        walls.push(
          new AABB(
            foundX - minClingFactor + bodyXWidth,
            footY,
            oldBox.minZ,
            foundX - minClingFactor + bodyXWidth + 0.1,
            footY + 1,
            oldBox.maxZ
          )
        );
      }
    } else if (dx[0] < 0 && (isDangerousDropNxPz || isDangerousDropNxNz)) {
      const foundX = this.findCliffX(oldBox, footY, false);
      if (foundX !== null) {
        const minClingFactor = Math.min(
          clingingFactorInVoxel,
          oldBox.maxX - foundX
        );
        walls.push(
          new AABB(
            foundX + minClingFactor - bodyXWidth - 0.1,
            footY,
            oldBox.minZ,
            foundX + minClingFactor - bodyXWidth,
            footY + 1,
            oldBox.maxZ
          )
        );
      }
    }

    if (dx[2] > 0 && (isDangerousDropPxPz || isDangerousDropNxPz)) {
      const foundZ = this.findCliffVz(oldBox, footY, true);
      if (foundZ !== null) {
        const minClingFactor = Math.min(
          clingingFactorInVoxel,
          foundZ - oldBox.minZ
        );
        walls.push(
          new AABB(
            oldBox.minX,
            footY,
            foundZ - minClingFactor + bodyZWidth,
            oldBox.maxX,
            footY + 1,
            foundZ - minClingFactor + bodyZWidth + 0.1
          )
        );
      }
    } else if (dx[2] < 0 && (isDangerousDropPxNz || isDangerousDropNxNz)) {
      const foundZ = this.findCliffVz(oldBox, footY, false);
      if (foundZ !== null) {
        const minClingFactor = Math.min(
          clingingFactorInVoxel,
          oldBox.maxZ - foundZ
        );
        walls.push(
          new AABB(
            oldBox.minX,
            footY,
            foundZ + minClingFactor - bodyZWidth - 0.1,
            oldBox.maxX,
            footY + 1,
            foundZ + minClingFactor - bodyZWidth
          )
        );
      }
    }

    // process walls as collision
    if (walls.length > 0) {
      const tmpResting = [0, 0, 0];
      this.processCollisions(oldBox, [dx[0], 0, dx[2]], tmpResting, walls);
      body.aabb = oldBox;
      return true;
    }
    return false;
  };

  // Helper method to find ground in X direction
  findCliffX = (box: AABB, footY: number, isPx: boolean): number | null => {
    const startX = Math.floor(isPx ? box.minX : box.maxX);
    const endX = Math.floor(isPx ? box.maxX : box.minX);
    const startZ = Math.floor(box.maxZ);
    const endZ = Math.floor(box.minZ);
    const step = isPx ? 1 : -1;

    let cliffX = null;
    for (let x = startX; isPx ? x <= endX : x >= endX; x += step) {
      for (let z = startZ; z >= endZ; z--) {
        const voxel = [x, footY - Engine.EPSILON * 3, z];
        if (this.isEmpty(voxel)) {
          continue;
        }
        const aabbs = this.getVoxel(voxel[0], voxel[1], voxel[2]);
        if (aabbs.length === 0) {
          continue;
        }
        const union = aabbs.reduce((acc, aabb) => acc.union(aabb), aabbs[0]);
        if (union.maxY + Engine.EPSILON < footY) continue;
        cliffX = isPx ? union.maxX : union.minX;
      }
    }
    return cliffX;
  };

  // Helper method to find ground in Z direction
  findCliffVz = (box: AABB, footY: number, isPz: boolean): number | null => {
    const startX = Math.floor(box.maxX);
    const endX = Math.floor(box.minX);
    const startZ = Math.floor(isPz ? box.minZ : box.maxZ);
    const endZ = Math.floor(isPz ? box.maxZ : box.minZ);
    const step = isPz ? 1 : -1;

    let cliffZ = null;
    for (let z = startZ; isPz ? z <= endZ : z >= endZ; z += step) {
      for (let x = startX; x >= endX; x--) {
        const voxel = [x, footY - Engine.EPSILON * 3, z];
        if (this.isEmpty(voxel)) {
          continue;
        }
        const aabbs = this.getVoxel(voxel[0], voxel[1], voxel[2]);
        if (aabbs.length === 0) {
          continue;
        }
        const union = aabbs.reduce((acc, aabb) => acc.union(aabb), aabbs[0]);
        if (union.maxY + Engine.EPSILON < footY) continue;
        cliffZ = isPz ? union.maxZ : union.minZ;
      }
    }
    return cliffZ;
  };

  isRaycastEmpty = (voxel: number[], direction: number[]) => {
    const result = raycast(this.getVoxel, voxel, direction, Engine.EPSILON * 3);
    return !result;
  };

  isDangerousDrop = (position: number[], stepHeight: number): boolean => {
    const checkDistance = stepHeight + 0.1;
    const result = raycast(this.getVoxel, position, [0, -1, 0], checkDistance);
    return !result;
  };

  isEmpty = (voxel: number[]) => {
    const result = this.getVoxel(voxel[0], voxel[1], voxel[2]);
    return result.length === 0;
  };

  applyFluidForces = (body: RigidBody) => {
    const box = body.aabb;
    const cx = Math.floor(box.minX);
    const cz = Math.floor(box.minZ);
    const y0 = Math.floor(box.minY);
    const y1 = Math.floor(box.maxY);

    const feetInFluid = this.testFluid(cx, y0, cz);
    const headInFluid = this.testFluid(cx, y1, cz);

    if (!feetInFluid && !headInFluid) {
      body.inFluid = false;
      body.ratioInFluid = 0;
      return;
    }

    let ratioInFluid: number;

    if (feetInFluid) {
      let submerged = 1;
      let cy = y0 + 1;
      while (cy <= y1 && this.testFluid(cx, cy, cz)) {
        submerged++;
        cy++;
      }
      const fluidLevel = y0 + submerged;
      const heightInFluid = fluidLevel - box.minY;
      ratioInFluid = heightInFluid / (box.maxY - box.minY);
      if (ratioInFluid > 1) ratioInFluid = 1;
    } else {
      let submergedFromTop = 1;
      let cy = y1 - 1;
      while (cy >= y0 && this.testFluid(cx, cy, cz)) {
        submergedFromTop++;
        cy--;
      }
      const fluidBottom = y1 - submergedFromTop + 1;
      const heightInFluid = box.maxY - fluidBottom;
      ratioInFluid = heightInFluid / (box.maxY - box.minY);
      if (ratioInFluid > 1) ratioInFluid = 1;
      if (ratioInFluid < 0) ratioInFluid = 0;
    }

    const vol =
      (box.maxX - box.minX) * (box.maxY - box.minY) * (box.maxZ - box.minZ);
    const displaced = vol * ratioInFluid;
    const scale = -this.options.fluidDensity * displaced;
    const f = [
      this.options.gravity[0] * scale,
      this.options.gravity[1] * scale,
      this.options.gravity[2] * scale,
    ];
    body.applyForce(f);

    body.inFluid = true;
    body.ratioInFluid = ratioInFluid;

    const fluidFlowForce = this.getFluidFlowForce(cx, y0, cz);
    if (fluidFlowForce > 0) {
      const currentStage = this.getVoxelStage(cx, y0, cz);
      let flowDirX = 0;
      let flowDirZ = 0;

      const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      for (const [dx, dz] of neighbors) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (this.testFluid(nx, y0, nz)) {
          const neighborStage = this.getVoxelStage(nx, y0, nz);
          if (neighborStage > currentStage) {
            flowDirX += dx;
            flowDirZ += dz;
          }
        }
      }

      const flowLen = Math.sqrt(flowDirX * flowDirX + flowDirZ * flowDirZ);
      if (flowLen > 0) {
        flowDirX /= flowLen;
        flowDirZ /= flowLen;
        const effectiveRatio = Math.max(ratioInFluid, 0.3);
        const forceMag = fluidFlowForce * effectiveRatio;
        body.applyForce([flowDirX * forceMag, 0, flowDirZ * forceMag]);
      }
    }
  };

  applyClimbableForces = (body: RigidBody) => {
    const box = body.aabb;
    const minVx = Math.floor(box.minX);
    const maxVx = Math.floor(box.maxX);
    const minVy = Math.floor(box.minY);
    const maxVy = Math.floor(box.maxY);
    const minVz = Math.floor(box.minZ);
    const maxVz = Math.floor(box.maxZ);

    let intersectsClimbable = false;

    for (let vx = minVx; vx <= maxVx && !intersectsClimbable; vx++) {
      for (let vy = minVy; vy <= maxVy && !intersectsClimbable; vy++) {
        for (let vz = minVz; vz <= maxVz && !intersectsClimbable; vz++) {
          const climbableAABBs = this.getClimbableAABBs(vx, vy, vz);
          for (const climbableAABB of climbableAABBs) {
            if (box.intersects(climbableAABB)) {
              intersectsClimbable = true;
              break;
            }
          }
        }
      }
    }

    body.onClimbable = intersectsClimbable;

    let hasClimbableAtFeet = false;
    if (intersectsClimbable) {
      const feetY = Math.floor(box.minY + 0.1);
      for (let vx = minVx; vx <= maxVx && !hasClimbableAtFeet; vx++) {
        for (let vz = minVz; vz <= maxVz && !hasClimbableAtFeet; vz++) {
          const climbableAABBs = this.getClimbableAABBs(vx, feetY, vz);
          if (climbableAABBs.length > 0) {
            hasClimbableAtFeet = true;
          }
        }
      }
    }
    body.climbableAbove = hasClimbableAtFeet;
  };

  applyFrictionByAxis = (axis: number, body: RigidBody, dvel: number[]) => {
    // friction applies only if moving into a touched surface
    const restDir = body.resting[axis];
    const vNormal = dvel[axis];
    if (restDir === 0) return;
    if (restDir * vNormal <= 0) return;

    // current vel lateral to friction axis
    const lateralVel = [...body.velocity];
    lateralVel[axis] = 0;
    const vCurr = Math.sqrt(
      lateralVel[0] ** 2 + lateralVel[1] ** 2 + lateralVel[2] ** 2
    );
    if (approxEquals(vCurr, 0)) return;

    // treat current change in velocity as the result of a pseudoforce
    //        Fpseudo = m*dv/dt
    // Base friction force on normal component of the pseudoforce
    //        Ff = u * Fnormal
    //        Ff = u * m * dvnormal / dt
    // change in velocity due to friction force
    //        dvF = dt * Ff / m
    //            = dt * (u * m * dvnormal / dt) / m
    //            = u * dvnormal
    const dvMax = Math.abs(body.friction * vNormal);

    // decrease lateral vel by dvMax (or clamp to zero)
    const scalar = vCurr > dvMax ? (vCurr - dvMax) / vCurr : 0;

    // For horizontal wall collisions (X or Z axis), only apply friction to horizontal movement
    // Don't reduce Y velocity when sliding against walls - this allows proper jumping
    if (axis === 0) {
      // X collision: only reduce Z velocity, not Y
      body.velocity[2] *= scalar;
    } else if (axis === 2) {
      // Z collision: only reduce X velocity, not Y
      body.velocity[0] *= scalar;
    } else {
      // Y collision (floor/ceiling): reduce both X and Z
      body.velocity[0] *= scalar;
      body.velocity[2] *= scalar;
    }
  };

  processCollisions = (
    box: AABB,
    velocity: number[],
    resting: number[],
    extras: AABB[] = []
  ) => {
    resting[0] = 0;
    resting[1] = 0;
    resting[2] = 0;

    sweep(
      this.getVoxel,
      box,
      velocity,
      function (_: number, axis: number, dir: number, vec: number[]) {
        resting[axis] = dir;
        vec[axis] = 0;
        return false;
      },
      true,
      100,
      extras
    );
  };

  tryAutoStepping = (body: RigidBody, oldBox: AABB, dx: number[]) => {
    if (body.inFluid) return;
    if (body.resting[1] >= 0) return;

    // // direction movement was blocked before trying a step
    const xBlocked = body.resting[0] !== 0;
    const zBlocked = body.resting[2] !== 0;
    if (!(xBlocked || zBlocked)) return;

    // original target position before being obstructed
    const targetPos = [
      oldBox.minX + dx[0],
      oldBox.minY + dx[1],
      oldBox.minZ + dx[2],
    ];

    let voxel: number[] = [];

    // move towards the target until the first X/Z collision
    sweep(
      this.getVoxel,
      oldBox,
      dx,
      function (
        _: number,
        axis: number,
        dir: number,
        vec: number[],
        vox?: number[]
      ) {
        if (axis === 1) {
          vec[axis] = 0;
          return false;
        } else {
          voxel = vox || [];
          return true;
        }
      }
    );

    const y = body.aabb.minY;

    let maxStep = 0;

    if (voxel) {
      const aabbs = this.getVoxel(voxel[0], voxel[1], voxel[2]);
      aabbs.forEach((a) => {
        if (a.maxY > maxStep) maxStep = a.maxY;
      });
    }

    const yDist = Math.floor(y) + maxStep - y + Engine.EPSILON;
    const upVec = [0, Math.min(yDist, body.stepHeight + 0.001), 0];
    let collided = false;

    // sweep up, bailing on any obstruction
    sweep(this.getVoxel, oldBox, upVec, function () {
      collided = true;
      return true;
    });
    if (collided) {
      // could't move upwards
      return;
    }

    // now move in X/Z however far was left over before hitting the obstruction
    const leftover = [
      targetPos[0] - oldBox.minX,
      targetPos[1] - oldBox.minY,
      targetPos[2] - oldBox.minZ,
    ];
    leftover[1] = 0;
    const tmpResting = [0, 0, 0];
    this.processCollisions(oldBox, leftover, tmpResting);

    // move down a bit to avoid stepping too high, bail on collision
    const temp = oldBox.clone();
    sweep(this.getVoxel, temp, [0, -yDist, 0], (dist) => {
      if (dist > Engine.EPSILON)
        oldBox.translate([0, -dist + Engine.EPSILON, 0]);
      return true;
    });

    // done - oldBox is now at the target autostepped position

    // if the new position is below the old position, then the new position is invalid
    // since we trying to step upwards
    if (oldBox.minY < y) {
      return;
    }

    body.resting[0] = tmpResting[0];
    body.resting[2] = tmpResting[2];

    if (body.onStep) body.onStep(oldBox, tmpResting);
    else body.aabb = oldBox.clone();
  };

  isBodyAsleep = (body: RigidBody, dt: number, noGravity: boolean) => {
    if (body.sleepFrameCount > 0) return false;

    // without gravity bodies stay asleep until a force/impulse wakes them up
    if (noGravity) return true;

    // otherwise check body is resting against something
    // i.e. sweep along by distance d = 1/2 g*t^2
    // and check there's still a collision
    let isResting = false;
    const gMult = 0.5 * dt * dt * body.gravityMultiplier;
    const sleepVec = [
      this.options.gravity[0] * gMult,
      this.options.gravity[1] * gMult,
      this.options.gravity[2] * gMult,
    ];

    sweep(
      this.getVoxel,
      body.aabb,
      sleepVec,
      function () {
        isResting = true;
        return true;
      },
      false
    );

    return isResting;
  };

  teleport = (body: RigidBody, position: number[], duration: number) => {
    const frames = 1000;

    const old = body.getPosition();
    const dx = (position[0] - old[0]) / frames;
    const dy = (position[1] - old[1]) / frames;
    const dz = (position[2] - old[2]) / frames;

    setInterval(() => {
      body.aabb.translate([dx, dy, dz]);
    }, duration / frames);
  };
}

export * from "./rigid-body";
export * from "./sweep";
