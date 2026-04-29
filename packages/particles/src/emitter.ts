import { Material, Mesh, Object3D, Sprite, Vector3 } from "three";
import { SpriteNodeMaterial } from "three/webgpu";

import type { Behavior } from "./behavior";
import { SpanLike, toSpan } from "./math";
import { Particle } from "./particle";
import { Rate } from "./rate";
import { getDefaultSpriteTexture } from "./sprite-texture";

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export type DeadListener = (emitter: Emitter) => void;

const INFINITE_DURATION = Number.POSITIVE_INFINITY;

export class Emitter {
  readonly position = new Vector3();

  private rate = new Rate(1, 0.05);
  private behaviors: Behavior[] = [];
  private particles: Particle[] = [];
  private deadListeners: DeadListener[] = [];

  private isEmitting = false;
  private remainingDuration = 0;
  private timeUntilNextBurst = 0;
  private pendingBurstCount = 0;

  setRate(rate: Rate): this {
    this.rate = rate;
    return this;
  }

  setPosition(position: Vector3Like): this {
    this.position.set(position.x, position.y, position.z);
    return this;
  }

  addBehaviors(behaviors: Behavior[]): this {
    this.behaviors.push(...behaviors);
    return this;
  }

  addInitializers(behaviors: Behavior[]): this {
    return this.addBehaviors(behaviors);
  }

  addOnEmitterDeadEventListener(listener: DeadListener): this {
    this.deadListeners.push(listener);
    return this;
  }

  emit(durationSeconds: number = INFINITE_DURATION): this {
    this.isEmitting = true;
    this.remainingDuration = durationSeconds;
    this.timeUntilNextBurst = 0;
    return this;
  }

  burst(count: SpanLike): this {
    const sampled = Math.max(0, Math.round(toSpan(count).sample()));
    this.pendingBurstCount += sampled;
    return this;
  }

  stopEmit(): this {
    this.isEmitting = false;
    return this;
  }

  get aliveCount(): number {
    return this.particles.length;
  }

  get isFinished(): boolean {
    return !this.isEmitting && this.particles.length === 0;
  }

  update(dt: number, group: Object3D): boolean {
    if (this.pendingBurstCount > 0) {
      const count = this.pendingBurstCount;
      this.pendingBurstCount = 0;
      for (let i = 0; i < count; i++) this.spawnParticle(group);
    }

    if (this.isEmitting) {
      this.timeUntilNextBurst -= dt;
      this.remainingDuration -= dt;
      while (this.timeUntilNextBurst <= 0 && this.isEmitting) {
        this.spawnBurst(group);
        const next = this.rate.nextInterval();
        this.timeUntilNextBurst += next;
        if (next === 0) break;
      }
      if (this.remainingDuration <= 0) {
        this.isEmitting = false;
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.age += dt;
      for (const behavior of this.behaviors) {
        behavior.apply?.(particle, dt, this);
      }
      particle.position.addScaledVector(particle.velocity, dt);
      this.syncObject(particle);
      if (particle.age >= particle.life) {
        this.killParticle(particle, group);
        this.particles.splice(i, 1);
      }
    }

    if (!this.isEmitting && this.particles.length === 0) {
      const listeners = this.deadListeners;
      this.deadListeners = [];
      for (const listener of listeners) listener(this);
      return true;
    }

    return false;
  }

  private spawnBurst(parent: Object3D): void {
    const count = this.rate.nextCount();
    for (let i = 0; i < count; i++) this.spawnParticle(parent);
  }

  private spawnParticle(parent: Object3D): void {
    const particle = new Particle();
    particle.alive = true;
    particle.position.copy(this.position);
    for (const behavior of this.behaviors) {
      behavior.initialize?.(particle, this);
    }
    if (!particle.object) {
      particle.object = this.createDefaultSprite();
    }
    this.syncObject(particle);
    parent.add(particle.object);
    this.particles.push(particle);
  }

  private syncObject(particle: Particle): void {
    const object = particle.object;
    if (!object) return;
    object.position.copy(particle.position);
    object.rotation.copy(particle.rotation);
    object.scale.setScalar(particle.scale);
    applyColorAndAlpha(object, particle);
  }

  private killParticle(particle: Particle, parent: Object3D): void {
    for (const behavior of this.behaviors) behavior.onDestroy?.(particle);
    if (particle.object) {
      parent.remove(particle.object);
      disposeVisual(particle.object);
    }
    particle.alive = false;
  }

  private createDefaultSprite(): Sprite {
    const material = new SpriteNodeMaterial({
      map: getDefaultSpriteTexture(),
      transparent: true,
      depthWrite: false,
    });
    return new Sprite(material);
  }
}

function applyColorAndAlpha(object: Object3D, particle: Particle): void {
  if (object instanceof Sprite) {
    tintMaterial(object.material, particle);
    return;
  }
  object.traverse((child) => {
    if (child instanceof Mesh) {
      forEachMaterial(child.material, (m) => tintMaterial(m, particle));
    }
  });
}

interface TintableMaterial extends Material {
  color: { copy: (c: { r: number; g: number; b: number }) => unknown };
  opacity: number;
}

function isTintable(material: Material): material is TintableMaterial {
  return (
    "color" in material &&
    typeof (material as { opacity?: unknown }).opacity === "number"
  );
}

function tintMaterial(material: Material, particle: Particle): void {
  if (!isTintable(material)) return;
  material.color.copy(particle.color);
  material.opacity = particle.alpha;
}

function forEachMaterial(
  material: Material | Material[],
  fn: (m: Material) => void,
): void {
  if (Array.isArray(material)) material.forEach(fn);
  else fn(material);
}

function disposeVisual(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Sprite) {
      forEachMaterial(child.material, (m) => m.dispose());
      return;
    }
    if (child instanceof Mesh) {
      forEachMaterial(child.material, (m) => m.dispose());
    }
  });
}
