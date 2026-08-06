import type { Vector3 } from "three";

import type { ParticleSystem } from "./system";
import type { EmitterOptions, ParticleConfig } from "./types";

/**
 * Continuous emission with a fractional-spawn accumulator, so slow rates
 * emit evenly instead of aliasing against the frame rate. One emitter per
 * moving source (a rocket's exhaust, a chimney); the emitter holds no
 * resources, so dropping it is cleanup enough.
 */
export class ParticleEmitter {
  private carry = 0;

  constructor(
    private readonly system: ParticleSystem,
    private readonly config: ParticleConfig,
    private readonly options: EmitterOptions,
  ) {}

  emitAt(position: Vector3, deltaSec: number, direction?: Vector3): void {
    this.carry += this.options.ratePerSecond * deltaSec;
    let toSpawn = Math.floor(this.carry);
    this.carry -= toSpawn;
    while (toSpawn > 0) {
      toSpawn -= 1;
      this.system.spawnOne(this.config, position, {
        speed: this.options.speed,
        direction,
        spreadRad: this.options.spreadRad,
        jitterRadius: this.options.jitterRadius,
        sizeScale: this.options.sizeScale,
      });
    }
  }
}
