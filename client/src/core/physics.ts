import {
  Engine as PhysicsEngine,
  EngineOptions,
  BodyOptions,
  RigidBody,
} from "@voxelize/physics-engine";

import { Client } from "..";
import { ChunkUtils } from "../utils";

/**
 * A **built-in** physics engine for Voxelize using [@voxelize/physics-engine](https://github.com/shaoruu/voxel-physics-engine).
 *
 * @category Core
 */
class Physics {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * The core physics engine.
   */
  public core: PhysicsEngine;

  /**
   * A function called before every update per tick.
   */
  public onBeforeUpdate?: () => void;

  /**
   * A function called after every update per tick.
   */
  public onAfterUpdate?: () => void;

  /**
   * Construct a Voxelize physics engine.
   *
   * @hidden
   */
  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Add a physical body to the Voxelize client-side world.
   *
   * @param options - Options for adding a new physical rigid body.
   */
  addBody = (options: Partial<BodyOptions>) => {
    return this.core.addBody(options);
  };

  /**
   * Remove a rigid body from the Voxelize client-side world.
   *
   * @param body - The rigid body to remove.
   */
  removeBody = (body: RigidBody) => {
    this.core.removeBody(body);
  };

  /**
   * Initialize the Voxel physics engine.
   *
   * @hidden
   * @internal
   * @param params - World parameters sent from the server.
   */
  initialize = (params: EngineOptions) => {
    this.core = new PhysicsEngine(
      (vx: number, vy: number, vz: number) => {
        const id = this.client.world.getVoxelByVoxel(vx, vy, vz);
        const rotation = this.client.world.getVoxelRotationByVoxel(vx, vy, vz);
        const { aabbs } = this.client.registry.getBlockById(id);
        return aabbs.map((aabb) =>
          rotation.rotateAABB(aabb).translate([vx, vy, vz])
        );
      },
      (vx: number, vy: number, vz: number) => {
        const id = this.client.world.getVoxelByVoxel(vx, vy, vz);
        const { isFluid } = this.client.registry.getBlockById(id);
        return isFluid;
      },
      params
    );
  };

  /**
   * Updater for Voxelize physics.
   *
   * @hidden
   */
  update = () => {
    if (!this.core) return;

    this.onBeforeUpdate?.();

    const { controls, world } = this.client;

    const coords = ChunkUtils.mapVoxelPosToChunkPos(
      controls.voxel,
      world.params.chunkSize
    );
    const chunk = world.getChunkByVoxel(...controls.voxel);

    if ((!chunk || !chunk.isReady) && world.isWithinWorld(...coords)) {
      return;
    }

    const dt = this.client.clock.delta;
    this.core.update(Math.min(dt, 0.02));

    this.onAfterUpdate?.();
  };

  /**
   * A list of rigid bodies in this physics engine.
   */
  get bodies() {
    return this.core.bodies;
  }
}

export { Physics };
