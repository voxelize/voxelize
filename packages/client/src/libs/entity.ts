import { Object3D, Vector3 } from "three";

import { Client } from "..";

type Vec3 = { x: number; y: number; z: number };

abstract class Entity {
  id: string;
  type: string;

  position: Vector3;
  target: Vector3;
  heading: Vector3;

  mesh: Object3D;

  static LERP_FACTOR: number;

  constructor() {
    this.position = new Vector3();
    this.target = new Vector3();
    this.heading = new Vector3();
  }

  onEvent?: (e: any) => void;
  onCreation?: (client: Client) => void;
  onDeletion?: (client: Client) => void;

  onTarget = () => {
    this.mesh.lookAt(this.target);
  };

  onPosition = () => {
    if (Entity.LERP_FACTOR) {
      this.mesh.position.lerp(this.position, Entity.LERP_FACTOR);
    }
  };

  update = (position: Vec3, target: Vec3, heading: Vec3) => {
    this.position.set(position.x, position.y, position.z);
    this.target.set(target.x, target.y, target.z);
    this.heading.set(heading.x, heading.y, heading.z);

    if (this.onPosition) {
      this.onPosition();
    }

    if (this.onTarget) {
      this.onTarget();
    }
  };
}

export { Entity };
