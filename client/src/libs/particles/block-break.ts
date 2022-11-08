import { AABB } from "@voxelize/aabb";
import { Engine, RigidBody } from "@voxelize/physics-engine";
import { MessageProtocol } from "@voxelize/transport/src/types";
import { NetIntercept } from "core";
import { Clock } from "three";
import {
  Behaviour,
  Body,
  BoxZone,
  Emitter,
  Life,
  Position,
  Rate,
  Scale,
  Span,
  System,
} from "three-nebula";

import { World } from "../../core/world";
import { BlockUtils } from "../../utils";

/**
 * A rigid behavior makes the particle act like a rigid body in the voxel physics engine.
 */
export class Rigid extends Behaviour {
  /**
   * The size of the rigid particle.
   */
  public size: number;

  /**
   * The initial impulse of the rigid particle, which goes in a random direction with this impulse as
   * the magnitude of impulse.
   */
  public impulse: number;

  /**
   * A reference to the physics engine of the world for update purposes.
   */
  public engine: Engine;

  /**
   * Create a new rigid behavior.
   *
   * @param size The size of the rigid particle.
   * @param impulse The initial impulse of the rigid particle.
   * @param engine A reference to the physics engine of the world for update purposes.
   * @param life The life of the particle.
   * @param easing The easing function of the particle.
   * @param isEnabled Whether the behavior is enabled.
   */
  constructor(
    size: number,
    impulse: number,
    engine: Engine,
    life?: unknown,
    easing?: unknown,
    isEnabled = true
  ) {
    super(life, easing, "Rigid", isEnabled);

    this.size = size;
    this.impulse = impulse;
    this.engine = engine;
  }

  /**
   * Called by `three-nebula` when the particle is created.
   *
   * @param particle The particle being initialized.
   * @hidden
   */
  initialize(particle: any) {
    particle.rigidbody = new RigidBody(
      new AABB(0, 0, 0, this.size, this.size, this.size),
      1,
      1,
      0,
      1,
      0
    );
    const { x, y, z } = particle.position;
    particle.rigidbody.applyImpulse([
      Math.random() * this.impulse * 2 - this.impulse,
      Math.random() * this.impulse * 2 - this.impulse,
      Math.random() * this.impulse * 2 - this.impulse,
    ]);
    particle.rigidbody.setPosition([x, y, z]);
    particle.clock = new Clock();
    particle.rotation.set(
      Math.random() * 2 * Math.PI,
      Math.random() * 2 * Math.PI,
      Math.random() * 2 * Math.PI
    );
  }

  /**
   * Called by `three-nebula` when the particle is updated.
   *
   * @param particle The particle being updated.
   * @hidden
   */
  mutate(particle: any) {
    const delta = particle.clock.getDelta();
    this.engine.iterateBody(particle.rigidbody, delta, false);
    const [px, py, pz] = particle.rigidbody.getPosition();
    particle.position.set(px, py, pz);
  }
}

/**
 * Parameters to create a block break particle system.
 */
export type BlockBreakParticlesParams = {
  /**
   * The minimum count of a particle to be emitted per block break. Defaults to `15`.
   */
  minCount: number;

  /**
   * The maximum count of a particle to be emitted per block break. Defaults to `25`.
   */
  maxCount: number;

  /**
   * The maximum block breaks for a regular particle emission. Otherwise, a burst is emitted.
   * Defaults to `5`.
   */
  capSize: number;

  /**
   * The scale of which the lifespans of the particles that are emitted in bursts are scaled.
   * Defaults to `0.1`.
   */
  capScale: number;

  /**
   * The size of the rigid particles. Defaults to `0.1`.
   */
  scale: number;

  /**
   * The initial impulse of the rigid particles. Defaults to `3`.
   */
  impulse: number;

  /**
   * The minimum lifespan of the particles. Defaults to `2`.
   */
  minLife: number;

  /**
   * The maximum lifespan of the particles. Defaults to `4`.
   */
  maxLife: number;

  /**
   * Around the center of the block break, the dimension of the box-sized zone in which the particles
   * are emitted from. Defaults to `1`.
   */
  zoneWidth: number;
};

const defaultParams: BlockBreakParticlesParams = {
  minCount: 15,
  maxCount: 25,
  capSize: 5,
  capScale: 0.1,
  scale: 0.1,
  impulse: 3,
  minLife: 2,
  maxLife: 4,
  zoneWidth: 1,
};

/**
 * A particle system that emits particles when a block is broken. This system implements `NetIntercept` and
 * listens to any `UPDATE` type message which indicates a block break. Remember to call `network.register` to
 * register this system to listen to incoming network packets.
 *
 * This module depends on the [`three-nebula`](https://three-nebula.org/) package.
 *
 * # Example
 * ```ts
 * import { MeshRenderer } from "three-nebula";
 *
 * const particleRenderer = new MeshRenderer(world, THREE);
 * const particles = new VOXELIZE.BlockBreakParticles(world, { ... });
 * particles.addRenderer(particleRenderer);
 *
 * // Listen to incoming network packets.
 * network.register(particles);
 *
 * // In the animate loop.
 * particles.update();
 * ```
 *
 * ![Block break particles](/img/block-break-particles.png)
 *
 * @category Effects
 */
export class BlockBreakParticles extends System implements NetIntercept {
  /**
   * Parameters to create a block break particle system.
   */
  private params: BlockBreakParticlesParams;

  /**
   * Create a new block break particle system.
   *
   * @param world The world that the particle system is in.
   * @param params Parameters to create a block break particle system.
   */
  constructor(
    public world: World,
    params: Partial<BlockBreakParticlesParams> = {}
  ) {
    super();

    this.params = { ...defaultParams, ...params };
  }

  [key: string]: any;

  onMessage = (message: MessageProtocol) => {
    if (message.type !== "UPDATE") return;

    const { updates } = message;

    updates?.forEach(({ vx, vy, vz, voxel }) => {
      const oldID = this.world.getPreviousVoxelByVoxel(vx, vy, vz);
      const newID = BlockUtils.extractID(voxel as number);

      if (oldID === 0 || newID !== 0) return;

      const mesh = this.world.makeBlockMesh(oldID);
      const lightScale = this.world.getLightColorByVoxel(vx, vy, vz);
      mesh.material.color.copy(lightScale);

      const emitter = new Emitter();

      const tooMany = updates.length > this.params.capSize;

      emitter
        .setRate(
          new Rate(
            new Span(
              tooMany ? (Math.random() > 0.5 ? 1 : 0) : this.params.minCount,
              tooMany ? 1 : this.params.maxCount
            ),
            new Span(0.1, 0.25)
          )
        )
        .addInitializers([
          new Life(
            this.params.minLife * (tooMany ? this.params.capScale : 1),
            this.params.maxLife * (tooMany ? this.params.capScale : 1)
          ),
          new Body(mesh),
          new Position(new BoxZone(this.params.zoneWidth)),
        ])
        .addBehaviours([
          new Scale(this.params.scale, this.params.scale),
          new Rigid(this.params.scale, 3, this.world.physics),
        ])
        .setPosition({ x: vx + 0.5, y: vy + 0.5, z: vz + 0.5 })
        .addOnEmitterDeadEventListener(() => {
          this.removeEmitter(emitter);
        })
        .emit(1);

      this.addEmitter(emitter);
    });
  };
}
