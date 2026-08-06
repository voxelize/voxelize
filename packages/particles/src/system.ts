import {
  Camera,
  Color,
  Euler,
  Group,
  Matrix4,
  PointLight,
  Quaternion,
  Vector3,
} from "three";

import { ParticleEmitter } from "./emitter";
import { ParticleLayer, relaunchBody } from "./layer";
import type {
  BurstOptions,
  EmitterOptions,
  FlashOptions,
  ParticleConfig,
  ParticlePhysics,
  ParticleSystemOptions,
  ParticleWorld,
  SpawnMotion,
} from "./types";

const DEFAULT_OPTIONS: ParticleSystemOptions = {
  capacityPerLayer: 768,
  maxFlashLights: 4,
};

const TAU = Math.PI * 2;

/** Clear of the surface it landed on, so a settled quad cannot z-fight it. */
const SETTLE_SURFACE_GAP = 0.02;

/** An invisible, instantly-dead particle: enough to force a shader compile. */
const WARM_CONFIG: ParticleConfig = {
  blend: "normal",
  lifetimeSec: { min: 0.05, max: 0.05 },
  size: { min: 0.01, max: 0.01 },
  sizeOverLife: { from: 1, to: 1 },
  alphaOverLife: { from: 0, to: 0 },
  palette: ["#000000"],
  riseAccel: 0,
  dragPerSec: 0,
  turbulence: 0,
  spinRadPerSec: 0,
};

const WHITE = new Color(0xffffff);

type FlashSlot = {
  light: PointLight;
  age: number;
  durationSec: number;
  peakIntensity: number;
};

/**
 * Pooled particle renderer: one instanced draw call per look family over
 * preallocated SoA buffers, so smoke columns, block fragments, falling leaves
 * and firework shells from any feature share one allocator and one hard cap.
 * Nothing here allocates per frame or per spawn; a particle storm degrades by
 * dropping new spawns, never by hitching.
 *
 * Consumers describe LOOKS with a {@link ParticleConfig} and MOTION at the
 * call site: `burst` for one-shots, `createEmitter` for a continuous stream
 * following a moving source, `AmbientBlockEmitter` for blocks in the world
 * that emit on their own.
 *
 * Layers compile a shader the first time they draw, so every config a feature
 * will use must be declared to {@link ParticleSystem.prewarm} during the load
 * phase.
 */
export class ParticleSystem {
  private readonly group = new Group();
  private readonly layers = new Map<string, ParticleLayer>();
  private readonly flashes: FlashSlot[] = [];
  private flashCursor = 0;
  private readonly capacityPerLayer: number;

  private readonly scratchColor = new Color();
  private readonly scratchPosition = new Vector3();
  private readonly scratchQuaternion = new Quaternion();
  private readonly scratchSpinQuaternion = new Quaternion();
  private readonly scratchEuler = new Euler();
  private readonly scratchScale = new Vector3();
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchDir = new Vector3();
  private readonly scratchAxisA = new Vector3();
  private readonly scratchAxisB = new Vector3();
  private readonly viewAxis = new Vector3(0, 0, 1);

  constructor(
    private readonly world: ParticleWorld,
    options: Partial<ParticleSystemOptions> = {},
  ) {
    const { capacityPerLayer, maxFlashLights } = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    this.capacityPerLayer = capacityPerLayer;
    for (let i = 0; i < maxFlashLights; i += 1) {
      const light = new PointLight(WHITE, 0, 0);
      light.visible = false;
      this.group.add(light);
      this.flashes.push({ light, age: 0, durationSec: 0, peakIntensity: 0 });
    }
    this.world.add(this.group);
    for (const blend of ["additive", "normal"] as const) {
      this.prewarm({ ...WARM_CONFIG, blend });
    }
  }

  /**
   * Builds a config's layer and compiles its shader now. Every feature must
   * do this during the load phase: a layer built on first spawn compiles a
   * shader mid-play, which was measured at a one-off 133ms frame.
   */
  prewarm(config: ParticleConfig): void {
    this.resolveLayer(config, true);
    this.scratchPosition.set(0, -1000, 0);
    this.spawnOne(
      {
        ...WARM_CONFIG,
        blend: config.blend,
        shape: config.shape,
        texture: config.texture,
        physics: config.physics,
        isCutout: config.isCutout,
      },
      this.scratchPosition,
      { speed: { min: 0, max: 0 } },
    );
  }

  burst(config: ParticleConfig, options: BurstOptions): void {
    for (let i = 0; i < options.count; i += 1) {
      this.spawnOne(config, options.position, options);
    }
  }

  createEmitter(
    config: ParticleConfig,
    options: EmitterOptions,
  ): ParticleEmitter {
    return new ParticleEmitter(this, config, options);
  }

  /** Brief pooled light pop (explosions); reuses the oldest slot when full. */
  flash(position: Vector3, options: FlashOptions): void {
    const slot = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    slot.light.color.set(options.color);
    slot.light.intensity = options.intensity;
    slot.light.distance = options.distance;
    slot.light.position.copy(position);
    slot.light.visible = true;
    slot.age = 0;
    slot.durationSec = options.durationSec;
    slot.peakIntensity = options.intensity;
  }

  spawnOne(
    config: ParticleConfig,
    position: { x: number; y: number; z: number },
    motion: SpawnMotion,
  ): void {
    const layer = this.resolveLayer(config, false);
    if (layer.alive >= layer.capacity) return;
    const i = layer.alive;
    layer.alive += 1;

    const jitter = motion.jitterRadius ?? 0;
    layer.posX[i] = position.x + (Math.random() - 0.5) * 2 * jitter;
    layer.posY[i] = position.y + (Math.random() - 0.5) * 2 * jitter;
    layer.posZ[i] = position.z + (Math.random() - 0.5) * 2 * jitter;

    const speed = sample(motion.speed);
    const dir = this.pickDirection(motion);
    const bias = motion.velocityBias;
    layer.velX[i] = dir.x * speed + (bias?.x ?? 0);
    layer.velY[i] = dir.y * speed + (bias?.y ?? 0);
    layer.velZ[i] = dir.z * speed + (bias?.z ?? 0);

    layer.age[i] = 0;
    layer.life[i] = sample(config.lifetimeSec);

    const size = sample(config.size) * (motion.sizeScale ?? 1);
    layer.sizeStart[i] = size * config.sizeOverLife.from;
    layer.sizeEnd[i] = size * config.sizeOverLife.to;
    layer.alphaStart[i] = config.alphaOverLife.from;
    layer.alphaEnd[i] = config.alphaOverLife.to;
    layer.alphaHold[i] = config.alphaOverLife.holdFrac ?? 0;

    const start = this.scratchColor.set(
      motion.color ??
        config.palette[Math.floor(Math.random() * config.palette.length)],
    );
    layer.colStartR[i] = start.r;
    layer.colStartG[i] = start.g;
    layer.colStartB[i] = start.b;
    const end = config.fadeToColor
      ? this.scratchColor.set(config.fadeToColor)
      : start;
    layer.colEndR[i] = end.r;
    layer.colEndG[i] = end.g;
    layer.colEndB[i] = end.b;

    layer.riseAccel[i] = config.riseAccel;
    layer.dragPerSec[i] = config.dragPerSec;
    layer.turbulence[i] = config.turbulence;
    layer.spinRate[i] = config.spinRadPerSec;
    layer.spinPhase[i] = Math.random() * TAU;

    const swayAngle = Math.random() * TAU;
    const swaySpeed = config.sway?.speed ?? 0;
    layer.swayVelX[i] = Math.cos(swayAngle) * swaySpeed;
    layer.swayVelZ[i] = Math.sin(swayAngle) * swaySpeed;
    layer.swayFreq[i] = config.sway?.frequencyHz ?? 0;

    layer.isSettling[i] = config.isSettlingOnGround ? 1 : 0;
    layer.isSettled[i] = 0;

    if (layer.bodies) {
      relaunchBody(
        layer.bodies[i],
        layer.posX[i],
        layer.posY[i],
        layer.posZ[i],
        layer.velX[i],
        layer.velY[i],
        layer.velZ[i],
      );
    }

    if (config.texture) {
      const region = motion.textureRegion ?? config.texture.region;
      const uSpan = region.endU - region.startU;
      const vSpan = region.endV - region.startV;
      const patchU = uSpan * config.texture.patchFraction;
      const patchV = vSpan * config.texture.patchFraction;
      layer.writeUvRect(
        i,
        region.startU + Math.random() * (uSpan - patchU),
        region.startV + Math.random() * (vSpan - patchV),
        patchU,
        patchV,
      );
    }
  }

  update(deltaSec: number, camera: Camera): void {
    const dt = Math.min(deltaSec, 0.05);
    for (const layer of this.layers.values()) this.stepLayer(layer, dt, camera);
    this.stepFlashes(dt);
  }

  dispose(): void {
    for (const layer of this.layers.values()) layer.dispose();
    this.layers.clear();
    for (const flash of this.flashes) flash.light.dispose();
    this.world.remove(this.group);
  }

  private resolveLayer(
    config: ParticleConfig,
    isPrewarming: boolean,
  ): ParticleLayer {
    const shape = config.shape ?? "cube";
    const isCutout = config.isCutout === true;
    const key = `${config.blend}|${shape}|${config.texture?.key ?? ""}|${physicsKey(
      config.physics,
    )}|${isCutout ? "cutout" : "soft"}`;
    const existing = this.layers.get(key);
    if (existing) return existing;

    if (!isPrewarming) {
      console.warn(
        `[particles] layer ${key} was built on first spawn: its shader ` +
          "compiles during play. Prewarm the config in the load phase.",
      );
    }
    const layer = new ParticleLayer(this.capacityPerLayer, {
      key,
      blend: config.blend,
      shape,
      map: config.texture?.map ?? null,
      physics: config.physics ?? null,
      isCutout,
    });
    this.layers.set(key, layer);
    this.group.add(layer.mesh);
    return layer;
  }

  private pickDirection(motion: SpawnMotion): Vector3 {
    const out = this.scratchDir;
    if (motion.direction) {
      // Cone around the axis: axis + tangent jitter scaled by the half-angle.
      const spread = Math.tan(motion.spreadRad ?? 0);
      const axis = motion.direction;
      const a = this.scratchAxisA;
      const b = this.scratchAxisB;
      a.set(-axis.y, axis.x, 0);
      if (a.lengthSq() < 1e-6) a.set(0, -axis.z, axis.y);
      a.normalize();
      b.set(axis.x, axis.y, axis.z).cross(a);
      const angle = Math.random() * TAU;
      const radial = Math.random() * spread;
      out
        .set(axis.x, axis.y, axis.z)
        .addScaledVector(a, Math.cos(angle) * radial)
        .addScaledVector(b, Math.sin(angle) * radial);
      return out.normalize();
    }
    const theta = Math.random() * TAU;
    const phi = Math.acos(2 * Math.random() - 1);
    out.set(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    );
    if (motion.upwardBias) {
      const bias = motion.upwardBias;
      out.y = out.y * (1 - bias) + (Math.abs(out.y) + 0.35) * bias;
      out.normalize();
    }
    return out;
  }

  private stepLayer(layer: ParticleLayer, dt: number, camera: Camera): void {
    const bodies = layer.bodies;
    for (let i = layer.alive - 1; i >= 0; i -= 1) {
      layer.age[i] += dt;
      if (layer.age[i] >= layer.life[i]) {
        layer.removeAt(i);
        continue;
      }
      if (layer.isSettled[i]) continue;

      if (bodies) {
        // The engine owns motion for these: gravity, drag and collision are
        // its job, and layering the drift model on top would fight it.
        const body = bodies[i];
        this.world.physics.iterateBody(body, dt, false);
        const [px, py, pz] = body.getPosition();
        layer.posX[i] = px;
        layer.posY[i] = py;
        layer.posZ[i] = pz;
        continue;
      }

      layer.velY[i] += layer.riseAccel[i] * dt;
      const drag = Math.max(0, 1 - layer.dragPerSec[i] * dt);
      layer.velX[i] *= drag;
      layer.velY[i] *= drag;
      layer.velZ[i] *= drag;
      const turb = layer.turbulence[i];
      if (turb > 0) {
        layer.velX[i] += (Math.random() - 0.5) * turb * dt;
        layer.velY[i] += (Math.random() - 0.5) * turb * dt;
        layer.velZ[i] += (Math.random() - 0.5) * turb * dt;
      }
      layer.posX[i] += layer.velX[i] * dt;
      layer.posY[i] += layer.velY[i] * dt;
      layer.posZ[i] += layer.velZ[i] * dt;

      const swayFreq = layer.swayFreq[i];
      if (swayFreq > 0) {
        const phase = Math.sin(
          layer.age[i] * swayFreq * TAU + layer.spinPhase[i],
        );
        layer.posX[i] += layer.swayVelX[i] * phase * dt;
        layer.posZ[i] += layer.swayVelZ[i] * phase * dt;
      }

      if (layer.isSettling[i] && layer.velY[i] < 0 && !this.settle(layer, i)) {
        layer.removeAt(i);
      }
    }

    // Write render state after removals so instance i maps to particle i.
    const colors = layer.mesh.instanceColor;
    const isBillboard = layer.spec.shape === "billboard";
    for (let i = 0; i < layer.alive; i += 1) {
      const t = layer.age[i] / layer.life[i];
      const size =
        layer.sizeStart[i] + (layer.sizeEnd[i] - layer.sizeStart[i]) * t;
      const spin = layer.spinPhase[i] + layer.age[i] * layer.spinRate[i];

      this.scratchPosition.set(layer.posX[i], layer.posY[i], layer.posZ[i]);
      if (isBillboard) {
        // Face the camera, then spin in the plane of the screen.
        this.scratchSpinQuaternion.setFromAxisAngle(this.viewAxis, spin);
        this.scratchQuaternion
          .copy(camera.quaternion)
          .multiply(this.scratchSpinQuaternion);
      } else if (layer.isSettled[i]) {
        // Spun about its own normal first, then tipped flat, so a landed
        // quad lies on the surface at a random angle instead of standing
        // up in it.
        this.scratchEuler.set(-Math.PI / 2, 0, layer.spinPhase[i]);
        this.scratchQuaternion.setFromEuler(this.scratchEuler);
      } else {
        this.scratchEuler.set(spin, 0, spin * 0.83);
        this.scratchQuaternion.setFromEuler(this.scratchEuler);
      }
      this.scratchScale.setScalar(Math.max(size, 1e-4));
      this.scratchMatrix.compose(
        this.scratchPosition,
        this.scratchQuaternion,
        this.scratchScale,
      );
      layer.mesh.setMatrixAt(i, this.scratchMatrix);

      if (colors) {
        colors.array[i * 3] =
          layer.colStartR[i] + (layer.colEndR[i] - layer.colStartR[i]) * t;
        colors.array[i * 3 + 1] =
          layer.colStartG[i] + (layer.colEndG[i] - layer.colStartG[i]) * t;
        colors.array[i * 3 + 2] =
          layer.colStartB[i] + (layer.colEndB[i] - layer.colStartB[i]) * t;
      }
      const hold = layer.alphaHold[i];
      const alphaT = hold > 0 ? Math.max(0, (t - hold) / (1 - hold)) : t;
      layer.writeAlpha(
        i,
        layer.alphaStart[i] +
          (layer.alphaEnd[i] - layer.alphaStart[i]) * alphaT,
      );
    }
    layer.markDirty();
  }

  /**
   * Reports whether the particle survives: it lands on the block it just
   * entered, keeps falling through empty space, or is absorbed by a fluid.
   */
  private settle(layer: ParticleLayer, i: number): boolean {
    const vy = Math.floor(layer.posY[i]);
    const block = this.world.getBlockAt(
      Math.floor(layer.posX[i]),
      vy,
      Math.floor(layer.posZ[i]),
    );
    if (!block) return true;
    if (block.isFluid) return false;
    if (block.isPassable || block.isEmpty) return true;
    layer.posY[i] = vy + 1 + SETTLE_SURFACE_GAP;
    layer.velX[i] = 0;
    layer.velY[i] = 0;
    layer.velZ[i] = 0;
    layer.isSettled[i] = 1;
    return true;
  }

  private stepFlashes(dt: number): void {
    for (const flash of this.flashes) {
      if (!flash.light.visible) continue;
      flash.age += dt;
      const t = flash.age / flash.durationSec;
      if (t >= 1) {
        flash.light.visible = false;
        flash.light.intensity = 0;
        continue;
      }
      flash.light.intensity = flash.peakIntensity * (1 - t) * (1 - t);
    }
  }
}

function physicsKey(physics: ParticlePhysics | undefined): string {
  if (!physics) return "";
  return `${physics.bodySize}:${physics.friction}:${physics.restitution}:${physics.gravityMultiplier}`;
}

function sample(range: { min: number; max: number }): number {
  return range.min + Math.random() * (range.max - range.min);
}
