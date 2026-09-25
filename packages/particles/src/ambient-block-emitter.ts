import type { Vector3 } from "three";

import {
  type AmbientBeatContext,
  AmbientSiteScheduler,
  type AmbientSiteSchedulerOptions,
} from "./ambient-site-scheduler";
import type { ParticleBlock, ParticleWorld } from "./types";

export {
  getAmbientParticleDensity,
  setAmbientParticleDensity,
} from "./ambient-density";

/**
 * Blocks that emit on their own: a torch that sputters, a canopy that sheds
 * leaves, a flower field that gives off pollen, tuned as a rate: how often a
 * block of the kind sheds, stated as the probe budget and chance it was
 * first tuned with.
 *
 * Emission is shared: this is an {@link AmbientSiteScheduler} underneath, so
 * each emitting block keeps a beat on the world's shared clock and every
 * player near it sees the same emission at the same moment, with the same
 * seeded `random` for its scatter. The probe options below are converted to
 * that schedule: a block emits `probesPerSecond / boxVolume * emitChance`
 * times a second on average, the rate the old random probe gave it.
 *
 * Effects whose sites need their own lifecycle (a dripstone tip growing a
 * drop, releasing it, recovering) are a different problem and keep their own
 * bookkeeping.
 */

export type AmbientBlockContext<TSource> = {
  /** Whatever `resolveSource` derived for this block, resolved once. */
  source: TSource;
  vx: number;
  vy: number;
  vz: number;
};

export type AmbientBlockEmitterOptions<TSource> = {
  /** Named in warnings; an emitter that resolves nothing says which one. */
  label: string;
  /** What emission needs from a registered block, or null if it never emits. */
  resolveSource: (block: ParticleBlock) => TSource | null;
  /**
   * The rate a block of this kind emits at, as a probe budget: voxels
   * sampled per second across the box, each emitting with `emitChance`.
   */
  probesPerSecond: number;
  /** Half-extents of the box around the listener, in voxels. */
  probeRadiusXZ: number;
  probeRadiusY: number;
  /** Ceiling for one frame's site sweep. */
  maxProbesPerFrame: number;
  /** Chance an eligible site emits, once it has passed `canEmitAt`. */
  emitChance: number;
  /**
   * Whether a matching block is a site at all, from the world around it.
   * Must be a pure function of world state. See
   * {@link AmbientSiteSchedulerOptions.isSite}.
   */
  isSite?: (context: AmbientBlockContext<TSource>) => boolean;
  /** Last-moment eligibility on an emitting beat. */
  canEmitAt?: (context: AmbientBlockContext<TSource>) => boolean;
  /**
   * Draw the emission. Take every choice from `context.random`, which every
   * client seeds alike, so the emission looks the same on every screen.
   */
  emit: (context: AmbientBeatContext<TSource>) => void;
  /** Longest beat a block keeps; faster kinds get shorter beats. */
  maxBeatSeconds?: number;
  /** Most blocks tracked at once; the nearest win. */
  maxSites?: number;
  /** Most blocks that emit at once, picked by a shared rank. */
  maxEmittingSites?: number;
  /** Seconds the sweep takes to find every block in the box. */
  sweepSeconds?: number;
  /** The clock beats are counted on; the world's shared clock by default. */
  clock?: () => number;
};

/** What the world's ambient effects look like to a join flow and a loop. */
export interface AmbientEmitter {
  prepare(): void;
  update(center: Vector3, deltaSec: number): void;
}

/** Beats are kept at or under an even chance, so shedding never ticks. */
const MAX_BEAT_CHANCE = 0.5;

/**
 * The beat a probe budget converts to: the average emissions a second one
 * block got from the random probe, as a beat length and a chance per beat.
 */
export function beatScheduleForProbeRate(options: {
  probesPerSecond: number;
  probeRadiusXZ: number;
  probeRadiusY: number;
  emitChance: number;
  maxBeatSeconds?: number;
}): { beatSeconds: number; emitChance: number } {
  const volume =
    options.probeRadiusXZ *
    2 *
    (options.probeRadiusXZ * 2) *
    (options.probeRadiusY * 2);
  const rate =
    volume > 0
      ? (options.probesPerSecond / volume) * Math.max(0, options.emitChance)
      : 0;
  const maxBeat = options.maxBeatSeconds ?? 1;
  if (rate <= 0) return { beatSeconds: maxBeat, emitChance: 0 };
  const beatSeconds = Math.min(maxBeat, MAX_BEAT_CHANCE / rate);
  return { beatSeconds, emitChance: Math.min(1, rate * beatSeconds) };
}

export class AmbientBlockEmitter<TSource> implements AmbientEmitter {
  readonly scheduler: AmbientSiteScheduler<TSource>;

  constructor(
    world: ParticleWorld,
    options: AmbientBlockEmitterOptions<TSource>,
  ) {
    const schedule = beatScheduleForProbeRate(options);
    const width = options.probeRadiusXZ * 2 + 1;
    const volume = width * width * (options.probeRadiusY * 2 + 1);
    const schedulerOptions: AmbientSiteSchedulerOptions<TSource> = {
      label: options.label,
      resolveSource: options.resolveSource,
      isSite: options.isSite,
      canEmitAt: options.canEmitAt,
      emit: options.emit,
      beatSeconds: schedule.beatSeconds,
      emitChance: schedule.emitChance,
      radiusXZ: options.probeRadiusXZ,
      radiusY: options.probeRadiusY,
      maxSites: options.maxSites ?? 1024,
      maxEmittingSites: options.maxEmittingSites ?? options.maxSites ?? 1024,
      sweepSeconds: options.sweepSeconds ?? 2,
      // The sweep is a cheap voxel read per step; the box is covered within
      // `sweepSeconds` at 30fps and above.
      maxSweepPerFrame: Math.max(
        options.maxProbesPerFrame,
        Math.ceil(volume / ((options.sweepSeconds ?? 2) * 30)),
      ),
      maxCatchUpBeats: 2,
      clock: options.clock,
    };
    this.scheduler = new AmbientSiteScheduler(world, schedulerOptions);
  }

  /**
   * Resolves which block ids emit. Belongs in the load phase: it reads the
   * registry the server sent, and whatever `resolveSource` needs from it
   * (atlas textures, particle layers) is one-time work too.
   */
  prepare(): void {
    this.scheduler.prepare();
  }

  update(center: Vector3, deltaSec: number): void {
    this.scheduler.update(center, deltaSec);
  }
}
