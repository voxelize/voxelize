import { AABB } from '@voxelize/voxel-aabb';

// massive thanks to https://github.com/andyhall/voxel-physics-engine/blob/master/src/rigidBody.js

class RigidBody {
  public airDrag: number;
  public fluidDrag: number;

  public resting = [0, 0, 0];
  public velocity = [0, 0, 0];
  public inFluid = false;
  public ratioInFluid = 0;
  public forces = [0, 0, 0];
  public impulses = [0, 0, 0];
  public sleepFrameCount = 10 | 0;

  constructor(
    public aabb: AABB,
    public mass: number,
    public friction: number,
    public restitution: number,
    public gravityMultiplier: number,
    public stepHeight: number,
    public onStep?: (newAABB: AABB, resting: number[]) => void,
    public onCollide?: (impacts?: number[]) => void,
  ) {
    this.airDrag = -1;
    this.fluidDrag = -1;
  }

  setPosition = (p: number[]) => {
    this.aabb.setPosition([
      p[0] - this.aabb.width / 2,
      p[1] - this.aabb.height / 2,
      p[2] - this.aabb.depth / 2,
    ]);

    this.markActive();
  };

  getPosition = () => {
    return [
      this.aabb.minX + this.aabb.width / 2,
      this.aabb.minY + this.aabb.height / 2,
      this.aabb.minZ + this.aabb.depth / 2,
    ];
  };

  applyForce = (f: number[]) => {
    this.forces[0] += f[0];
    this.forces[1] += f[1];
    this.forces[2] += f[2];
    this.markActive();
  };

  applyImpulse = (i: number[]) => {
    this.impulses[0] += i[0];
    this.impulses[1] += i[1];
    this.impulses[2] += i[2];
    this.markActive();
  };

  markActive = () => {
    this.sleepFrameCount = 10 | 0;
  };

  get atRestX() {
    return this.resting[0];
  }

  get atRestY() {
    return this.resting[1];
  }

  get atRestZ() {
    return this.resting[2];
  }
}

export { RigidBody };
