import type { Vector3 } from "three";

import type { ParticleBlock, ParticleWorld } from "./types";

/**
 * Blocks that emit on their own: a torch that sputters, a canopy that sheds
 * leaves, a flower field that gives off pollen. The world is far too big to
 * walk looking for them, so this samples random voxels around the listener
 * instead. Emission then scales with whatever is actually nearby — a forest
 * rains leaves, a clearing does nothing — with no registry of sites to keep
 * up to date as chunks and edits come and go.
 *
 * This is the stateless half of ambient VFX. Effects whose sites need their
 * own lifecycle (a dripstone tip growing a drop, releasing it, recovering)
 * are a different problem and keep their own bookkeeping.
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
   * Voxels sampled per second, not per frame. Per frame would make the same
   * world sputter twice as hard on a machine that renders twice as fast.
   */
  probesPerSecond: number;
  /** Half-extents of the probe box around the listener, in voxels. */
  probeRadiusXZ: number;
  probeRadiusY: number;
  /** Ceiling for one frame, so a long frame cannot repay itself in a storm. */
  maxProbesPerFrame: number;
  /** Chance an eligible site emits, once it has passed `canEmitAt`. */
  emitChance: number;
  /** Whether the site is eligible at all — open air below a canopy, say. */
  canEmitAt?: (context: AmbientBlockContext<TSource>) => boolean;
  emit: (context: AmbientBlockContext<TSource>) => void;
};

/** What the world's ambient effects look like to a join flow and a loop. */
export interface AmbientEmitter {
  prepare(): void;
  update(center: Vector3, deltaSec: number): void;
}

/** Scales every ambient emitter at once; 0 turns ambient particles off. */
let ambientDensity = 1;

export function setAmbientParticleDensity(density: number): void {
  ambientDensity = Math.max(0, density);
}

export function getAmbientParticleDensity(): number {
  return ambientDensity;
}

export class AmbientBlockEmitter<TSource> implements AmbientEmitter {
  private readonly sources = new Map<number, TSource>();
  private isPrepared = false;
  private carry = 0;

  constructor(
    private readonly world: ParticleWorld,
    private readonly options: AmbientBlockEmitterOptions<TSource>,
  ) {}

  /**
   * Resolves which block ids emit. Belongs in the load phase: it reads the
   * registry the server sent, and whatever `resolveSource` needs from it
   * (atlas textures, particle layers) is one-time work too.
   */
  prepare(): void {
    if (this.isPrepared) return;
    if (!this.world.isInitialized) {
      throw new Error(
        `[particles] ${this.options.label} was prepared before the world ` +
          "registry arrived; move the call after world.initialize()",
      );
    }
    for (const [id, block] of this.world.registry.blocksById) {
      const source = this.options.resolveSource(block);
      if (source !== null) this.sources.set(id, source);
    }
    if (this.sources.size === 0) {
      console.error(
        `[particles] ${this.options.label} matched no blocks in the ` +
          "registry, so it can never emit",
      );
    }
    this.isPrepared = true;
  }

  update(center: Vector3, deltaSec: number): void {
    if (!this.isPrepared) return;
    const density = getAmbientParticleDensity();
    if (density === 0) {
      this.carry = 0;
      return;
    }

    const { probesPerSecond, maxProbesPerFrame } = this.options;
    this.carry += probesPerSecond * density * deltaSec;
    const wanted = Math.floor(this.carry);
    this.carry -= wanted;
    // Sampling, not a work queue: probes past the frame's ceiling are meant
    // to be lost rather than owed, or a stutter would be followed by a gust.
    const probes = Math.min(wanted, maxProbesPerFrame);

    const { probeRadiusXZ, probeRadiusY, emitChance, canEmitAt, emit } =
      this.options;
    for (let i = 0; i < probes; i += 1) {
      const vx = Math.floor(center.x + (Math.random() * 2 - 1) * probeRadiusXZ);
      const vy = Math.floor(center.y + (Math.random() * 2 - 1) * probeRadiusY);
      const vz = Math.floor(center.z + (Math.random() * 2 - 1) * probeRadiusXZ);
      const id = this.world.getVoxelAt(vx, vy, vz);
      if (id === 0) continue;
      const source = this.sources.get(id);
      if (source === undefined) continue;

      // Eligibility before chance: it costs a lookup or two, but only on the
      // few probes that found the block at all, and it makes `emitChance`
      // mean "how often a site that could emit does" rather than a number
      // that drifts with how common the block happens to be.
      const context = { source, vx, vy, vz };
      if (canEmitAt && !canEmitAt(context)) continue;
      if (Math.random() >= emitChance) continue;
      emit(context);
    }
  }
}
