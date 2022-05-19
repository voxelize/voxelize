import { Engine as PhysicsEngine } from "@voxelize/voxel-physics-engine";

import { Client } from "..";

type PhysicsParams = {
  gravity: number[];
  minBounceImpulse: number;
  airDrag: number;
  fluidDrag: number;
  fluidDensity: number;
};

const defaultParams: PhysicsParams = {
  gravity: [0, -24.8, 0],
  minBounceImpulse: 0.5,
  airDrag: 0.1,
  fluidDrag: 1.4,
  fluidDensity: 1.4,
};

class Physics {
  public params: PhysicsParams;

  public core: PhysicsEngine;

  constructor(public client: Client, params: Partial<PhysicsParams> = {}) {
    this.params = { ...defaultParams, ...params };

    this.core = new PhysicsEngine(
      (vx: number, vy: number, vz: number) => {
        const id = client.chunks.getVoxelByVoxel(vx, vy, vz);
        const { aabbs } = client.registry.getBlockById(id);
        return aabbs;
      },
      (vx: number, vy: number, vz: number) => {
        const id = client.chunks.getVoxelByVoxel(vx, vy, vz);
        const { isFluid } = client.registry.getBlockById(id);
        return isFluid;
      },
      this.params
    );
  }

  update = () => {
    const [vx, vy, vz] = this.client.controls.voxel;
    const chunk = this.client.chunks.getChunkByVoxel(vx, vy, vz);

    if (!chunk) {
      return;
    }

    const dt = this.client.clock.delta;
    this.core.update(dt);
  };
}

export type { PhysicsParams };

export { Physics };