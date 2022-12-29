import { AABB } from '@voxelize/voxel-aabb';
import { RigidBody } from './rigid-body';
import { sweep } from './sweep';

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
    public options: EngineOptions,
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
      onCollide,
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
        this.options.gravity[2] ** 2,
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

    // semi-implicit Euler integration

    // a = f/m + gravity*gravityMultiplier
    const a = [
      body.forces[0] / body.mass +
        this.options.gravity[0] * body.gravityMultiplier,
      body.forces[1] / body.mass +
        this.options.gravity[1] * body.gravityMultiplier,
      body.forces[2] / body.mass +
        this.options.gravity[2] * body.gravityMultiplier,
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

    // if autostep, and on ground, run collisions again with stepped up aabb
    if (body.stepHeight > 0) {
      this.tryAutoStepping(body, tmpBox, dx);
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

  applyFluidForces = (body: RigidBody) => {
    // First pass at handling fluids. Assumes fluids are settled
    //   thus, only check at corner of body, and only from bottom up
    const box = body.aabb;
    const cx = Math.floor(box.minX);
    const cz = Math.floor(box.minZ);
    const y0 = Math.floor(box.minY);
    const y1 = Math.floor(box.maxY);

    if (!this.testFluid(cx, y0, cz)) {
      body.inFluid = false;
      body.ratioInFluid = 0;
      return;
    }

    // body is in a fluid - find out how much of body is submerged
    let submerged = 1;
    let cy = y0 + 1;
    while (cy <= y1 && this.testFluid(cx, cy, cz)) {
      submerged++;
      cy++;
    }
    const fluidLevel = y0 + submerged;
    const heightInFluid = fluidLevel - box.minY;
    let ratioInFluid = heightInFluid / (box.maxY - box.minY);
    if (ratioInFluid > 1) ratioInFluid = 1;
    const vol =
      (box.maxX - box.minX) * (box.maxY - box.minY) * (box.maxZ - box.minZ);
    const displaced = vol * ratioInFluid;
    // bouyant force = -gravity * fluidDensity * volumeDisplaced
    const scale = -this.options.fluidDensity * displaced;
    const f = [
      this.options.gravity[0] * scale,
      this.options.gravity[1] * scale,
      this.options.gravity[2] * scale,
    ];
    body.applyForce(f);

    body.inFluid = true;
    body.ratioInFluid = ratioInFluid;
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
      lateralVel[0] ** 2 + lateralVel[1] ** 2 + lateralVel[2] ** 2,
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
    body.velocity[(axis + 1) % 3] *= scalar;
    body.velocity[(axis + 2) % 3] *= scalar;
  };

  processCollisions = (box: AABB, velocity: number[], resting: number[]) => {
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
    );
  };

  tryAutoStepping = (body: RigidBody, oldBox: AABB, dx: number[]) => {
    if (body.resting[1] >= 0 && !body.inFluid) return;

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
        vox?: number[],
      ) {
        if (axis === 1) {
          vec[axis] = 0;
          return false;
        } else {
          voxel = vox || [];
          return true;
        }
      },
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

    // bail if no movement happened in the originally blocked direction
    if (xBlocked && !approxEquals(oldBox.minX, targetPos[0])) return;
    if (zBlocked && !approxEquals(oldBox.minZ, targetPos[2])) return;

    // move down a bit to avoid stepping too high, bail on collision
    const temp = oldBox.clone();
    sweep(this.getVoxel, temp, [0, -yDist, 0], (dist) => {
      if (dist > Engine.EPSILON)
        oldBox.translate([0, -dist + Engine.EPSILON, 0]);
      return true;
    });

    // done - oldBox is now at the target autostepped position

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
      false,
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

export * from './rigid-body';
export * from './sweep';
