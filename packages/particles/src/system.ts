import { Group } from "three";

import type { Emitter } from "./emitter";

export class ParticleSystem {
  readonly group = new Group();

  private readonly emitters: Emitter[] = [];
  private lastTimestamp: number | null = null;

  addEmitter(emitter: Emitter): this {
    this.emitters.push(emitter);
    return this;
  }

  removeEmitter(emitter: Emitter): this {
    const index = this.emitters.indexOf(emitter);
    if (index >= 0) this.emitters.splice(index, 1);
    return this;
  }

  update(dt?: number): void {
    const delta = dt ?? this.tickClock();
    const snapshot = this.emitters.slice();
    for (const emitter of snapshot) {
      if (this.emitters.indexOf(emitter) < 0) continue;
      const finished = emitter.update(delta, this.group);
      if (!finished) continue;
      const idx = this.emitters.indexOf(emitter);
      if (idx >= 0) this.emitters.splice(idx, 1);
    }
  }

  dispose(): void {
    this.emitters.length = 0;
    this.lastTimestamp = null;
    this.group.removeFromParent();
    this.group.clear();
  }

  private tickClock(): number {
    const now = performance.now();
    if (this.lastTimestamp === null) {
      this.lastTimestamp = now;
      return 0;
    }
    const delta = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;
    return delta;
  }
}
