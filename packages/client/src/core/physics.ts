import {
  AbstractMesh,
  IMotorEnabledJoint,
  IPhysicsEnginePlugin,
  PhysicsImpostor,
  PhysicsImpostorJoint,
  PhysicsJoint,
  Quaternion,
  Vector3,
} from "@babylonjs/core";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import { AABB } from "@voxelize/aabb";
import { Engine, RigidBody } from "@voxelize/physics-engine";

export class Physics implements IPhysicsEnginePlugin {
  world: Engine;

  name = "voxel-physics";

  private fixedTimeStep: number = 1 / 60;

  setGravity(gravity: Vector3): void {
    gravity.toArray(this.world.options.gravity);
  }

  setTimeStep(timeStep: number): void {
    this.fixedTimeStep = timeStep;
  }

  getTimeStep(): number {
    return this.fixedTimeStep;
  }

  executeStep(delta: number): void {
    this.world.update(delta);
  }

  getPluginVersion(): number {
    return 1;
  }

  applyImpulse(impostor: PhysicsImpostor, force: Vector3): void {
    impostor.physicsBody.applyImpulse(force.asArray());
  }

  applyForce(impostor: PhysicsImpostor, force: Vector3): void {
    impostor.physicsBody.applyForce(force.asArray());
  }

  generatePhysicsBody(impostor: PhysicsImpostor): void {
    const info = impostor.object.getBoundingInfo();
    const min = info.boundingBox.minimumWorld;
    const max = info.boundingBox.maximumWorld;

    this.world.addBody({
      aabb: new AABB(min[0], min[1], min[2], max[0], max[1], max[2]),
      mass: impostor.mass,
      friction: impostor.friction,
      restitution: impostor.restitution,
      // TODO: add `onCollide` callback
    });
  }

  removePhysicsBody(impostor: PhysicsImpostor): void {
    this.world.removeBody(impostor.physicsBody);
  }

  generateJoint(joint: PhysicsImpostorJoint): void {
    throw new Error("Method not implemented.");
  }

  removeJoint(joint: PhysicsImpostorJoint): void {
    throw new Error("Method not implemented.");
  }

  isSupported(): boolean {
    return true;
  }

  setTransformationFromPhysicsBody(impostor: PhysicsImpostor): void {
    const body = impostor.physicsBody as RigidBody;

    // Center of the body
    const position = body.getPosition();

    impostor.object.position.set(position[0], position[1], position[2]);

    throw new Error("Method not implemented.");
  }

  setPhysicsBodyTransformation(
    impostor: PhysicsImpostor,
    newPosition: Vector3
  ): void {
    impostor.physicsBody.setPosition(
      newPosition.x,
      newPosition.y,
      newPosition.z
    );
  }

  setLinearVelocity(impostor: PhysicsImpostor, velocity: Vector3): void {
    impostor.physicsBody.velocity = velocity.asArray();
  }

  setAngularVelocity(impostor: PhysicsImpostor, velocity: Vector3): void {
    // NOT SUPPORTED
  }

  getLinearVelocity(impostor: PhysicsImpostor): Vector3 {
    return Vector3.FromArray(impostor.physicsBody.velocity);
  }

  getAngularVelocity(impostor: PhysicsImpostor): Vector3 {
    // NOT SUPPORTED
    return Vector3.Zero();
  }

  setBodyMass(impostor: PhysicsImpostor, mass: number): void {
    impostor.physicsBody.mass = mass;
  }

  getBodyMass(impostor: PhysicsImpostor): number {
    return impostor.physicsBody.mass;
  }

  getBodyFriction(impostor: PhysicsImpostor): number {
    return impostor.physicsBody.friction;
  }

  setBodyFriction(impostor: PhysicsImpostor, friction: number): void {
    impostor.physicsBody.friction = friction;
  }

  getBodyRestitution(impostor: PhysicsImpostor): number {
    return impostor.physicsBody.restitution;
  }

  setBodyRestitution(impostor: PhysicsImpostor, restitution: number): void {
    impostor.physicsBody.restitution = restitution;
  }

  sleepBody(impostor: PhysicsImpostor): void {
    impostor.physicsBody.sleepFrameCount = 0;
  }

  wakeUpBody(impostor: PhysicsImpostor): void {
    throw new Error("Method not implemented.");
  }

  raycast(from: Vector3, to: Vector3): PhysicsRaycastResult {
    throw new Error("Method not implemented.");
  }
  raycastToRef(from: Vector3, to: Vector3, result: PhysicsRaycastResult): void {
    throw new Error("Method not implemented.");
  }
  updateDistanceJoint(
    joint: PhysicsJoint,
    maxDistance: number,
    minDistance?: number
  ): void {
    throw new Error("Method not implemented.");
  }
  setMotor(
    joint: IMotorEnabledJoint,
    speed: number,
    maxForce?: number,
    motorIndex?: number
  ): void {
    throw new Error("Method not implemented.");
  }
  setLimit(
    joint: IMotorEnabledJoint,
    upperLimit: number,
    lowerLimit?: number,
    motorIndex?: number
  ): void {
    throw new Error("Method not implemented.");
  }
  getRadius(impostor: PhysicsImpostor): number {
    throw new Error("Method not implemented.");
  }
  getBoxSizeToRef(impostor: PhysicsImpostor, result: Vector3): void {
    throw new Error("Method not implemented.");
  }
  syncMeshWithImpostor(mesh: AbstractMesh, impostor: PhysicsImpostor): void {
    throw new Error("Method not implemented.");
  }
  dispose(): void {
    throw new Error("Method not implemented.");
  }
}
