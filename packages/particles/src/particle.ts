import { Color, Euler, Object3D, Vector3 } from "three";

export class Particle {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly acceleration = new Vector3();
  readonly rotation = new Euler();
  readonly color = new Color(1, 1, 1);

  scale = 1;
  alpha = 1;

  age = 0;
  life = 1;
  alive = false;

  object: Object3D | null = null;

  reset(): void {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
    this.color.setRGB(1, 1, 1);
    this.scale = 1;
    this.alpha = 1;
    this.age = 0;
    this.life = 1;
    this.alive = false;
    this.object = null;
  }
}
