import { AABB } from "@voxelize/aabb";
import { Engine, RigidBody } from "@voxelize/physics-engine";
import { MessageProtocol } from "@voxelize/transport";
import { NetIntercept } from "core";
import { Clock } from "three";
import {
  Behaviour,
  Body,
  BoxZone,
  Emitter,
  Life,
  Mass,
  Position,
  Radius,
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

export class BlockBreakParticles extends System implements NetIntercept {
  constructor(public world: World, public particleCount = 20) {
    super();
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

      const emitter = new Emitter();
      emitter
        .setRate(
          new Rate(
            new Span(
              updates.length > 5 ? 0 : this.particleCount - 5,
              updates.length > 5 ? 1 : this.particleCount + 5
            ),
            new Span(0.1, 0.25)
          )
        )
        .addInitializers([
          new Radius(1),
          new Life(2, 4),
          new Body(mesh),
          new Position(new BoxZone(1)),
        ])
        .addBehaviours([
          new Scale(0.1, 0.1),
          new Rigid(0.1, 3, this.world.physics),
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
