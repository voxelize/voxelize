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

class Rigid extends Behaviour {
  constructor(
    public size: number,
    public impulse: number,
    public engine: Engine,
    life?: unknown,
    easing?: unknown,
    isEnabled = true
  ) {
    super(life, easing, "Rigid", isEnabled);
  }

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

  mutate(particle: any) {
    const delta = particle.clock.getDelta();
    this.engine.iterateBody(particle.rigidbody, delta, false);
    const [px, py, pz] = particle.rigidbody.getPosition();
    particle.position.set(px, py, pz);
  }
}

export type BlockBreakParticlesParams = {
  minCount: number;
  maxCount: number;
  capSize: number;
  capScale: number;
  scale: number;
  impulse: number;
  minLife: number;
  maxLife: number;
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

export class BlockBreakParticles extends System implements NetIntercept {
  private params: BlockBreakParticlesParams;

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
