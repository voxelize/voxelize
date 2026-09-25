import type { Vector3 } from "three";

import { getAmbientParticleDensity } from "./ambient-density";
import { hashSeed, type RandomSource, seededRandom, unitOf } from "./random";
import type { ParticleBlock, ParticleWorld } from "./types";

/**
 * Blocks that emit on their own, on a clock every client shares.
 *
 * A torch that sputters or a canopy that sheds a leaf is part of the world,
 * so two players standing by it must see the same ember or the same leaf at
 * the same moment. This finds the emitting blocks ("sites") near the
 * listener and gives each one a beat on the shared clock: a site emits on
 * `floor((clock + phase(site)) / beatSeconds)`, with a chance and a seeded
 * random source that are both functions of the site and the beat alone. Two
 * clients that know the same site and read the same clock therefore make the
 * same emission with the same scatter, whenever each of them found it.
 *
 * Sites are found by a sweep of the box around the listener, a fixed number
 * of voxels a second in a fixed order (no random probes), and rechecked when
 * a block changes under them. Past a cap, the sites that emit are the ones
 * with the lowest hash rank, a choice every client shares; past the tracking
 * cap, the nearest are kept.
 */

export type AmbientSiteContext<TSource> = {
  /** Whatever `resolveSource` derived for this block, resolved once. */
  source: TSource;
  vx: number;
  vy: number;
  vz: number;
};

export type AmbientBeatContext<TSource> = AmbientSiteContext<TSource> & {
  /** The beat of the shared clock this emission belongs to. */
  beat: number;
  /**
   * Seeded from the site and the beat: every client draws the same numbers
   * from it, in the same order. Use it for every choice the emission makes
   * (offsets, counts, which silhouette), and pass it to the particle system
   * as `random` so the scatter is shared too.
   */
  random: RandomSource;
  /**
   * Seconds since the beat, on the shared clock. Near zero on a steady
   * frame; larger on a beat a slow frame caught up on.
   */
  ageSeconds: number;
};

export type AmbientSiteSchedulerOptions<TSource> = {
  /** Named in warnings; a scheduler that resolves nothing says which one. */
  label: string;
  /** What emission needs from a registered block, or null if it never emits. */
  resolveSource: (block: ParticleBlock) => TSource | null;
  /**
   * Whether a matching block is a site at all, judged from the world around
   * it (open air below a leaf, water above a vent). Evaluated when a site is
   * found and whenever a block next to it changes. Must be a pure function
   * of world state, or clients track different sites.
   */
  isSite?: (context: AmbientSiteContext<TSource>) => boolean;
  /**
   * Last-moment eligibility on an emitting beat, after the beat's chance
   * has passed. May read per-frame state (a budget), at the cost of the
   * emission no longer being guaranteed identical across clients.
   */
  canEmitAt?: (context: AmbientSiteContext<TSource>) => boolean;
  emit: (context: AmbientBeatContext<TSource>) => void;
  /** Seconds between a site's beats. */
  beatSeconds: number;
  /** Chance a beat emits, before the ambient density scales it. */
  emitChance: number;
  /** Half-extents of the box around the listener that sites live in. */
  radiusXZ: number;
  radiusY: number;
  /** Optional spherical limit on which sites emit, inside the box. */
  emitRadius?: number;
  /** At most this many sites emit, picked by a rank every client shares. */
  maxEmittingSites: number;
  /** At most this many sites are tracked; the nearest win. */
  maxSites: number;
  /** Seconds the sweep takes to cover the whole box once. */
  sweepSeconds: number;
  /** Ceiling for one frame's sweep, so a long frame cannot stall on it. */
  maxSweepPerFrame: number;
  /** Beats a slow frame catches up on at most; older ones are let go. */
  maxCatchUpBeats: number;
  /** Mixed into every site's seed, so two schedulers on one block differ. */
  salt?: number;
  /**
   * The clock beats are counted on, in seconds. Omitted, the world's
   * `sharedClock` is used when it has one, and otherwise local time — which
   * keeps the schedule steady but no longer shared.
   */
  clock?: () => number;
};

/** A site the scheduler tracks. */
export type AmbientSite<TSource> = {
  x: number;
  y: number;
  z: number;
  source: TSource;
  /** Hashed from the voxel (and salt): the site's rank and beat phase. */
  seed: number;
  /** Seconds added to the clock before counting this site's beats. */
  phase: number;
  /** The last beat this site played; NaN until its first frame. */
  lastBeat: number;
  /** When its next beat falls on the clock; before it, a frame skips it. */
  nextBeatAt: number;
  /** Distance squared to the listener, as of the last reach check. */
  distanceSq: number;
  /** Within the box and under the emitting cap, as of the last check. */
  isInReach: boolean;
};

/** Offsets of the six face neighbours, flattened. */
const NEIGHBOURS = [
  0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
];

/** Voxels outside the box by this much are dropped, so edges do not flap. */
const FORGET_MARGIN = 2;

/** Blocks the listener moves (summed per axis) before reach is rechecked. */
const RANGE_RECHECK_DISTANCE = 0.25;

/** Mixed into a beat's seed for its emission's random source. */
const EMIT_SALT = 0x2f6b;

/**
 * The beats `site` emits on between its last beat and `clock`, appended to
 * `out`, advancing `site.lastBeat`. Pure: the same site, clock and chance
 * give the same beats on every client. A new site starts on the next beat,
 * and a clock set back waits for it.
 */
export function planSiteBeats(
  site: Pick<AmbientSite<unknown>, "seed" | "phase" | "lastBeat">,
  clock: number,
  beatSeconds: number,
  chance: number,
  maxCatchUpBeats: number,
  out: number[],
): void {
  const now = Math.floor((clock + site.phase) / beatSeconds);
  const last = site.lastBeat;
  site.lastBeat = now;
  if (!Number.isFinite(last) || now <= last) return;
  for (
    let beat = Math.max(last + 1, now - maxCatchUpBeats + 1);
    beat <= now;
    beat += 1
  ) {
    if (unitOf(hashSeed(site.seed, beat)) < chance) out.push(beat);
  }
}

/** The seed of the site at a voxel: its shared rank and phase. */
export function ambientSiteSeed(
  vx: number,
  vy: number,
  vz: number,
  salt = 0,
): number {
  return hashSeed(vx, vy, vz, salt);
}

/** The random source an emission on `beat` of the site with `seed` gets. */
export function ambientBeatRandom(seed: number, beat: number): RandomSource {
  return seededRandom(hashSeed(seed, beat, EMIT_SALT));
}

/** Packs a voxel into one exact number: |x|,|z| < 2^20, |y| < 2^10. */
function voxelKey(x: number, y: number, z: number): number {
  return ((x + 1048576) * 2097152 + (z + 1048576)) * 2048 + (y + 1024);
}

export class AmbientSiteScheduler<TSource> {
  /** Tracked sites, sorted by seed: the order ranks are read in. */
  readonly sites: AmbientSite<TSource>[] = [];
  readonly stats = { sites: 0, emitted: 0, swept: 0 };
  private readonly byKey = new Map<number, AmbientSite<TSource>>();
  private readonly sources = new Map<number, TSource>();
  private readonly beats: number[] = [];
  private readonly scratchContext: AmbientSiteContext<TSource> = {
    source: undefined as TSource,
    vx: 0,
    vy: 0,
    vz: 0,
  };
  private isPrepared = false;
  private sweepIndex = 0;
  private sweepCarry = 0;
  private localClock = 0;
  private stopListening: (() => void) | null = null;
  private centerX = 0;
  private centerY = 0;
  private centerZ = 0;
  private hasCenter = false;
  /** Where reach was last checked from, and whether the sites changed since. */
  private rangeX = Number.NaN;
  private rangeY = Number.NaN;
  private rangeZ = Number.NaN;
  private isRangeDirty = true;

  constructor(
    private readonly world: ParticleWorld,
    readonly options: AmbientSiteSchedulerOptions<TSource>,
  ) {}

  /**
   * Resolves which block ids are sites and starts listening for block
   * changes. Belongs in the load phase: it reads the registry the server
   * sent.
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
    this.stopListening =
      this.world.addBlockUpdateListener?.(({ voxel }) =>
        this.noteBlockUpdate(voxel[0], voxel[1], voxel[2]),
      ) ?? null;
    this.isPrepared = true;
  }

  dispose(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.sites.length = 0;
    this.byKey.clear();
    this.stats.sites = 0;
  }

  /**
   * A block changed: the voxel and its six neighbours are rechecked now,
   * so a torch placed in reach starts on its next beat and one broken stops
   * at once, and a leaf whose underside was filled in stops shedding.
   */
  noteBlockUpdate(vx: number, vy: number, vz: number): void {
    if (!this.isPrepared) return;
    for (let i = 0; i < NEIGHBOURS.length; i += 3) {
      this.recheck(
        vx + NEIGHBOURS[i],
        vy + NEIGHBOURS[i + 1],
        vz + NEIGHBOURS[i + 2],
      );
    }
  }

  update(center: Vector3, deltaSec: number): void {
    if (!this.isPrepared) return;
    this.localClock += Math.max(0, deltaSec);
    this.centerX = center.x;
    this.centerY = center.y;
    this.centerZ = center.z;
    this.hasCenter = true;
    this.sweep(deltaSec);

    // Which sites are in reach only changes when the listener moves or the
    // site list does, so it is not recomputed on a still frame.
    const moved =
      Math.abs(center.x - this.rangeX) +
      Math.abs(center.y - this.rangeY) +
      Math.abs(center.z - this.rangeZ);
    if (this.isRangeDirty || moved > RANGE_RECHECK_DISTANCE) {
      this.updateRange();
    }

    const density = getAmbientParticleDensity();
    const clock = this.readClock();
    const o = this.options;
    const chance = o.emitChance * density;
    const isSilent = chance <= 0;
    for (let i = 0; i < this.sites.length; i += 1) {
      const site = this.sites[i];
      if (!site.isInReach) continue;
      if (isSilent) {
        site.lastBeat = Number.NaN;
        site.nextBeatAt = Number.NEGATIVE_INFINITY;
        continue;
      }
      // Most frames fall between a site's beats: one comparison and on.
      if (clock < site.nextBeatAt && clock >= site.nextBeatAt - o.beatSeconds) {
        continue;
      }
      this.beats.length = 0;
      planSiteBeats(
        site,
        clock,
        o.beatSeconds,
        chance,
        o.maxCatchUpBeats,
        this.beats,
      );
      site.nextBeatAt = (site.lastBeat + 1) * o.beatSeconds - site.phase;
      for (let b = 0; b < this.beats.length; b += 1) {
        this.emitBeat(site, this.beats[b], clock);
      }
    }
    this.stats.sites = this.sites.length;
  }

  /**
   * Drops sites that left the box, and marks which of the rest emit: the
   * ones in reach, up to the cap, in shared rank order.
   */
  private updateRange(): void {
    const o = this.options;
    const emitRadiusSq =
      o.emitRadius === undefined ? Infinity : o.emitRadius * o.emitRadius;
    const { centerX, centerY, centerZ } = this;
    let emitting = 0;
    let write = 0;
    for (let read = 0; read < this.sites.length; read += 1) {
      const site = this.sites[read];
      const dx = site.x + 0.5 - centerX;
      const dy = site.y + 0.5 - centerY;
      const dz = site.z + 0.5 - centerZ;
      if (
        Math.abs(dx) > o.radiusXZ + FORGET_MARGIN ||
        Math.abs(dz) > o.radiusXZ + FORGET_MARGIN ||
        Math.abs(dy) > o.radiusY + FORGET_MARGIN
      ) {
        this.byKey.delete(voxelKey(site.x, site.y, site.z));
        continue;
      }
      this.sites[write] = site;
      write += 1;
      site.distanceSq = dx * dx + dy * dy + dz * dz;
      const isInReach =
        Math.abs(dx) <= o.radiusXZ &&
        Math.abs(dz) <= o.radiusXZ &&
        Math.abs(dy) <= o.radiusY &&
        site.distanceSq <= emitRadiusSq &&
        emitting < o.maxEmittingSites;
      if (isInReach) {
        emitting += 1;
      } else if (site.isInReach) {
        // Out of reach its beats go unplayed, and it restarts on the next
        // one when it comes back rather than replaying the gap.
        site.lastBeat = Number.NaN;
        site.nextBeatAt = Number.NEGATIVE_INFINITY;
      }
      site.isInReach = isInReach;
    }
    this.sites.length = write;
    this.stats.sites = write;
    this.rangeX = centerX;
    this.rangeY = centerY;
    this.rangeZ = centerZ;
    this.isRangeDirty = false;
  }

  /** The tracked site at a voxel, if any. */
  siteAt(vx: number, vy: number, vz: number): AmbientSite<TSource> | undefined {
    return this.byKey.get(voxelKey(vx, vy, vz));
  }

  private readClock(): number {
    if (this.options.clock) return this.options.clock();
    const shared = this.world.sharedClock;
    return typeof shared === "number" && Number.isFinite(shared)
      ? shared
      : this.localClock;
  }

  private emitBeat(
    site: AmbientSite<TSource>,
    beat: number,
    clock: number,
  ): void {
    const context = this.scratchContext;
    context.source = site.source;
    context.vx = site.x;
    context.vy = site.y;
    context.vz = site.z;
    if (this.options.canEmitAt && !this.options.canEmitAt(context)) return;
    const beatTime = beat * this.options.beatSeconds - site.phase;
    this.options.emit({
      source: site.source,
      vx: site.x,
      vy: site.y,
      vz: site.z,
      beat,
      random: ambientBeatRandom(site.seed, beat),
      ageSeconds: Math.max(0, clock - beatTime),
    });
    this.stats.emitted += 1;
  }

  /**
   * Visits the box around the listener in a fixed raster order, a budget
   * of voxels per frame, adding the sites it finds and dropping the ones
   * that stopped being sites.
   */
  private sweep(deltaSec: number): void {
    const o = this.options;
    const width = o.radiusXZ * 2 + 1;
    const height = o.radiusY * 2 + 1;
    const volume = width * width * height;
    this.sweepCarry +=
      (volume / Math.max(o.sweepSeconds, 1e-3)) * Math.max(0, deltaSec);
    const wanted = Math.floor(this.sweepCarry);
    this.sweepCarry -= wanted;
    // A sweep, not a work queue: voxels past the frame's ceiling are simply
    // reached on a later pass.
    const count = Math.min(wanted, o.maxSweepPerFrame, volume);
    const x0 = Math.floor(this.centerX) - o.radiusXZ;
    const y0 = Math.floor(this.centerY) - o.radiusY;
    const z0 = Math.floor(this.centerZ) - o.radiusXZ;
    for (let n = 0; n < count; n += 1) {
      const i = this.sweepIndex;
      this.sweepIndex = (i + 1) % volume;
      const x = x0 + (i % width);
      const z = z0 + (Math.floor(i / width) % width);
      const y = y0 + Math.floor(i / (width * width));
      this.recheck(x, y, z);
    }
    this.stats.swept += count;
  }

  /** Brings the tracking of one voxel in line with the world. */
  private recheck(x: number, y: number, z: number): void {
    const key = voxelKey(x, y, z);
    const tracked = this.byKey.get(key);
    const id = this.world.getVoxelAt(x, y, z);
    const source = id === 0 ? undefined : this.sources.get(id);
    let isSite = source !== undefined;
    if (isSite && this.options.isSite) {
      const context = this.scratchContext;
      context.source = source as TSource;
      context.vx = x;
      context.vy = y;
      context.vz = z;
      isSite = this.options.isSite(context);
    }
    if (!isSite) {
      if (tracked) this.remove(tracked, key);
      return;
    }
    if (tracked) {
      tracked.source = source as TSource;
      return;
    }
    this.add(x, y, z, source as TSource, key);
  }

  private add(
    x: number,
    y: number,
    z: number,
    source: TSource,
    key: number,
  ): void {
    const o = this.options;
    const dx = x + 0.5 - this.centerX;
    const dy = y + 0.5 - this.centerY;
    const dz = z + 0.5 - this.centerZ;
    const distanceSq = this.hasCenter ? dx * dx + dy * dy + dz * dz : 0;
    if (this.sites.length >= o.maxSites) {
      // Full: the nearest sites win, so two players standing together hold
      // the same ones.
      let farthest = -1;
      let farthestSq = distanceSq;
      for (let i = 0; i < this.sites.length; i += 1) {
        if (this.sites[i].distanceSq > farthestSq) {
          farthestSq = this.sites[i].distanceSq;
          farthest = i;
        }
      }
      if (farthest < 0) return;
      const dropped = this.sites[farthest];
      this.remove(dropped, voxelKey(dropped.x, dropped.y, dropped.z));
    }
    const seed = ambientSiteSeed(x, y, z, o.salt ?? 0);
    const site: AmbientSite<TSource> = {
      x,
      y,
      z,
      source,
      seed,
      phase: unitOf(seed) * o.beatSeconds,
      lastBeat: Number.NaN,
      nextBeatAt: Number.NEGATIVE_INFINITY,
      distanceSq,
      isInReach: false,
    };
    // Sorted insert by seed: ranks are read in array order.
    let lo = 0;
    let hi = this.sites.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sites[mid].seed < seed) lo = mid + 1;
      else hi = mid;
    }
    this.sites.splice(lo, 0, site);
    this.byKey.set(key, site);
    this.stats.sites = this.sites.length;
    this.isRangeDirty = true;
  }

  private remove(site: AmbientSite<TSource>, key: number): void {
    this.byKey.delete(key);
    const index = this.sites.indexOf(site);
    if (index >= 0) this.sites.splice(index, 1);
    this.stats.sites = this.sites.length;
    this.isRangeDirty = true;
  }
}
