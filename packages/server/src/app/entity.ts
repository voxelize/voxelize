import { Vector3 } from "@math.gl/core";

import { Entities } from "./entities";

abstract class Entity {
  id: string;
  type: string;
  data: any;

  position: Vector3;
  target: Vector3;
  heading: Vector3;

  private dirty = true;

  onCreation?: () => void;

  constructor() {
    this.position = new Vector3(0, 0, 0);
    this.target = new Vector3(0, 0, 0);
    this.heading = new Vector3(0, 0, 0);
  }

  setPosition = (x: number, y: number, z: number) => {
    this.position.set(x, y, z);
    this.dirty = true;
  };

  setTarget = (x: number, y: number, z: number) => {
    this.target.set(x, y, z);
    this.dirty = true;
  };

  setHeading = (x: number, y: number, z: number) => {
    this.heading.set(x, y, z);
    this.dirty = true;
  };

  setData = (data: any) => {
    this.data = data;
    this.dirty = true;
  };

  tick = (entities: Entities) => {
    if (!this.type || !this.id) {
      console.warn(
        `Skipping entity as field \`id\` or \`type\` are not assigned.`
      );
      return;
    }

    if (this.update) {
      this.update();
    }

    if (!this.dirty) {
      return;
    }

    const { x: px, y: py, z: pz } = this.position;
    const { x: tx, y: ty, z: tz } = this.target;
    const { x: hx, y: hy, z: hz } = this.heading;

    entities.addPacket({
      id: this.id,
      type: this.type,
      position: { x: px, y: py, z: pz },
      target: { x: tx, y: ty, z: tz },
      heading: { x: hx, y: hy, z: hz },
      data: JSON.stringify(this.data || {}),
    });

    this.dirty = false;
  };

  abstract update: () => void;
}

export { Entity };
