import type { Emitter } from "./emitter";
import type { Particle } from "./particle";

export interface Behavior {
  initialize?(particle: Particle, emitter: Emitter): void;
  apply?(particle: Particle, dt: number, emitter: Emitter): void;
  onDestroy?(particle: Particle): void;
}
