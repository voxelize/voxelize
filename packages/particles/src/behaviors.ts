import {
  Color,
  ColorRepresentation,
  Material,
  Mesh,
  Object3D,
  Vector3,
} from "three";

import type { Behavior } from "./behavior";
import { Easing } from "./easing";
import type { Emitter } from "./emitter";
import { Span, SpanLike, pick, toSpan } from "./math";
import type { Particle } from "./particle";
import type { Zone } from "./zones";

export class Life implements Behavior {
  private readonly span: Span;

  constructor(min: number, max?: number) {
    this.span = new Span(min, max ?? min);
  }

  initialize(particle: Particle): void {
    particle.life = this.span.sample();
    particle.age = 0;
  }
}

export class Position implements Behavior {
  private readonly tmp = new Vector3();
  constructor(public readonly zone: Zone) {}

  initialize(particle: Particle, emitter: Emitter): void {
    this.zone.sample(this.tmp);
    particle.position.copy(emitter.position).add(this.tmp);
  }
}

export class RadialVelocity implements Behavior {
  private readonly speed: Span;
  private readonly axis: Vector3;
  private readonly angleRad: number;

  constructor(speed: SpanLike, axis: Vector3, angleDegrees: number) {
    this.speed = toSpan(speed);
    this.axis = axis.clone().normalize();
    this.angleRad = (angleDegrees * Math.PI) / 180;
  }

  initialize(particle: Particle): void {
    const cosAngle = Math.cos(this.angleRad);
    const z = Math.random() * (1 - cosAngle) + cosAngle;
    const phi = Math.random() * Math.PI * 2;
    const sinTheta = Math.sqrt(1 - z * z);

    const local = new Vector3(
      Math.cos(phi) * sinTheta,
      Math.sin(phi) * sinTheta,
      z,
    );

    const reference =
      Math.abs(this.axis.z) < 0.999
        ? new Vector3(0, 0, 1)
        : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(reference, this.axis).normalize();
    const up = new Vector3().crossVectors(this.axis, right).normalize();

    const dir = new Vector3()
      .addScaledVector(right, local.x)
      .addScaledVector(up, local.y)
      .addScaledVector(this.axis, local.z);

    particle.velocity.copy(dir.multiplyScalar(this.speed.sample()));
  }
}

export class Gravity implements Behavior {
  constructor(public readonly strength: number = 9.81) {}

  apply(particle: Particle, dt: number): void {
    particle.velocity.y -= this.strength * dt;
  }
}

export class RandomDrift implements Behavior {
  private readonly span: Vector3;
  private readonly delay: number;
  private readonly timers = new WeakMap<Particle, number>();

  constructor(x: number, y: number, z: number, delaySeconds: number) {
    this.span = new Vector3(x, y, z);
    this.delay = Math.max(delaySeconds, 1e-4);
  }

  apply(particle: Particle, dt: number): void {
    const remaining = (this.timers.get(particle) ?? 0) - dt;
    if (remaining <= 0) {
      particle.velocity.x += (Math.random() * 2 - 1) * this.span.x;
      particle.velocity.y += (Math.random() * 2 - 1) * this.span.y;
      particle.velocity.z += (Math.random() * 2 - 1) * this.span.z;
      this.timers.set(particle, this.delay);
    } else {
      this.timers.set(particle, remaining);
    }
  }

  onDestroy(particle: Particle): void {
    this.timers.delete(particle);
  }
}

export class Scale implements Behavior {
  private readonly start: Span;
  private readonly end: Span;
  private readonly states = new WeakMap<
    Particle,
    { start: number; end: number }
  >();

  constructor(start: SpanLike, end: SpanLike) {
    this.start = toSpan(start);
    this.end = toSpan(end);
  }

  initialize(particle: Particle): void {
    const start = this.start.sample();
    const end = this.end.sample();
    this.states.set(particle, { start, end });
    particle.scale = start;
  }

  apply(particle: Particle): void {
    const state = this.states.get(particle);
    if (!state) return;
    const t = particle.life > 0 ? Math.min(particle.age / particle.life, 1) : 1;
    particle.scale = state.start + (state.end - state.start) * t;
  }

  onDestroy(particle: Particle): void {
    this.states.delete(particle);
  }
}

type ColorInput = ColorRepresentation | ColorRepresentation[] | null;

export class ColorOverLife implements Behavior {
  private readonly start: ColorRepresentation[];
  private readonly end: ColorRepresentation[] | null;
  private readonly easing?: Easing;
  private readonly states = new WeakMap<
    Particle,
    { start: Color; end: Color | null }
  >();

  constructor(options: {
    start: ColorInput;
    end?: ColorInput;
    easing?: Easing;
  }) {
    this.start = normalizeColors(options.start) ?? [0xffffff];
    this.end = normalizeColors(options.end ?? null);
    this.easing = options.easing;
  }

  initialize(particle: Particle): void {
    const start = new Color(pick(this.start));
    const end = this.end ? new Color(pick(this.end)) : null;
    this.states.set(particle, { start, end });
    particle.color.copy(start);
  }

  apply(particle: Particle): void {
    const state = this.states.get(particle);
    if (!state) return;
    if (!state.end) {
      particle.color.copy(state.start);
      return;
    }
    const tRaw =
      particle.life > 0 ? Math.min(particle.age / particle.life, 1) : 1;
    const t = this.easing ? this.easing(tRaw) : tRaw;
    particle.color.copy(state.start).lerp(state.end, t);
  }

  onDestroy(particle: Particle): void {
    this.states.delete(particle);
  }
}

function normalizeColors(input: ColorInput): ColorRepresentation[] | null {
  if (input === null || input === undefined) return null;
  return Array.isArray(input) ? input : [input];
}

export class Body implements Behavior {
  private readonly choices: ReadonlyArray<Object3D>;

  constructor(prototype: Object3D | Object3D[]) {
    this.choices = Array.isArray(prototype) ? prototype : [prototype];
  }

  initialize(particle: Particle): void {
    particle.object = cloneVisual(pick(this.choices));
  }
}

function cloneVisual(source: Object3D): Object3D {
  const cloned = source.clone(true);
  cloned.traverse((child) => {
    if (child instanceof Mesh) {
      child.material = cloneMaterial(child.material);
    }
  });
  return cloned;
}

function cloneMaterial(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map((m) => m.clone());
  return material.clone();
}

export type { SpanLike } from "./math";
