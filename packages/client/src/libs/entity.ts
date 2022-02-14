import { Mesh, Scene, Vector3 } from "three";

type Vec3 = { x: number; y: number; z: number };

abstract class Entity {
  id: string;
  type: string;

  position: Vector3;
  target: Vector3;
  heading: Vector3;

  mesh: Mesh;

  static LERP_FACTOR: number;

  constructor() {
    this.position = new Vector3();
    this.target = new Vector3();
    this.heading = new Vector3();
  }

  onEvent?: (e: any) => void;
  onCreation?: (scene: Scene) => void;
  tick?: () => void;

  update = (position: Vec3, target: Vec3, heading: Vec3) => {
    this.position.set(position.x, position.y, position.z);
    this.target.set(target.x, target.y, target.z);
    this.heading.set(heading.x, heading.y, heading.z);

    if (Entity.LERP_FACTOR) {
      this.mesh.position.lerp(this.position, Entity.LERP_FACTOR);
    }

    if (this.lookAt) {
      this.lookAt();
    }
  };

  protected abstract lookAt: () => void;
}

export { Entity };
