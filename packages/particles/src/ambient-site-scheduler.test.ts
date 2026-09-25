import { Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";

import {
  AmbientBlockEmitter,
  beatScheduleForProbeRate,
  setAmbientParticleDensity,
} from "./ambient-block-emitter";
import {
  type AmbientBeatContext,
  AmbientSiteScheduler,
  type AmbientSiteSchedulerOptions,
  planSiteBeats,
} from "./ambient-site-scheduler";
import type { ParticleBlock, ParticleWorld } from "./types";

const EMITTER_ID = 7;
const COVER_ID = 3;

const block = (id: number, name: string): ParticleBlock => ({
  id,
  name,
  isEmpty: false,
  isPassable: false,
  isFluid: false,
  faces: [],
});

type FakeWorld = ParticleWorld & {
  voxels: Map<string, number>;
  set(x: number, y: number, z: number, id: number): void;
  clockValue: number;
};

/** A world of loose voxels, a shared clock the test sets, and block updates. */
function fakeWorld(): FakeWorld {
  const voxels = new Map<string, number>();
  const listeners = new Set<
    (args: { voxel: [number, number, number] }) => void
  >();
  const world: FakeWorld = {
    voxels,
    clockValue: 0,
    get sharedClock() {
      return world.clockValue;
    },
    set(x, y, z, id) {
      if (id === 0) voxels.delete(`${x},${y},${z}`);
      else voxels.set(`${x},${y},${z}`, id);
      for (const listener of listeners) listener({ voxel: [x, y, z] });
    },
    addBlockUpdateListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isInitialized: true,
    add: () => undefined,
    remove: () => undefined,
    getVoxelAt: (x, y, z) => voxels.get(`${x},${y},${z}`) ?? 0,
    getBlockAt: () => null,
    getBlockFaceMaterial: () => undefined,
    getLightValuesAt: () => null,
    measureWaterColumnAt: () => null,
    registry: {
      blocksById: new Map([
        [EMITTER_ID, block(EMITTER_ID, "Emitter")],
        [COVER_ID, block(COVER_ID, "Cover")],
      ]),
    },
    chunkRenderer: {
      uniforms: {
        sunlightIntensity: { value: 1 },
        minLightLevel: { value: 0 },
        baseAmbient: { value: 0 },
      },
    },
    options: { maxLightLevel: 15 },
    physics: {} as ParticleWorld["physics"],
  };
  return world;
}

/** The same scattered handful of emitting blocks, built into a world. */
function populate(world: FakeWorld): [number, number, number][] {
  const sites: [number, number, number][] = [];
  for (let i = 0; i < 14; i += 1) {
    const site: [number, number, number] = [
      ((i * 37) % 17) - 8,
      60 + ((i * 11) % 5),
      ((i * 53) % 15) - 7,
    ];
    world.set(site[0], site[1], site[2], EMITTER_ID);
    sites.push(site);
  }
  return sites;
}

type Emission = { key: string; clock: number; draws: number[] };

function makeScheduler(
  world: FakeWorld,
  log: Emission[],
  overrides: Partial<AmbientSiteSchedulerOptions<string>> = {},
): AmbientSiteScheduler<string> {
  const scheduler = new AmbientSiteScheduler<string>(world, {
    label: "test sites",
    resolveSource: (b) => (b.id === EMITTER_ID ? "emitter" : null),
    emit: (context: AmbientBeatContext<string>) => {
      log.push({
        key: `${context.vx},${context.vy},${context.vz}#${context.beat}`,
        clock: world.clockValue - context.ageSeconds,
        draws: [context.random(), context.random(), context.random()],
      });
    },
    beatSeconds: 0.5,
    emitChance: 0.4,
    radiusXZ: 12,
    radiusY: 8,
    maxEmittingSites: 64,
    maxSites: 256,
    sweepSeconds: 1,
    maxSweepPerFrame: 100000,
    maxCatchUpBeats: 3,
    ...overrides,
  });
  scheduler.prepare();
  return scheduler;
}

/** Runs one client from `start` to `end` on the shared clock with its own frame steps. */
function run(
  scheduler: AmbientSiteScheduler<string>,
  world: FakeWorld,
  center: Vector3,
  start: number,
  end: number,
  step: (frame: number) => number,
): void {
  let t = start;
  let frame = 0;
  while (t < end) {
    const dt = step(frame);
    frame += 1;
    t = Math.min(end, t + dt);
    world.clockValue = t;
    scheduler.update(center, dt);
  }
}

const settled = (log: Emission[], after: number) =>
  log
    .filter((e) => e.clock >= after)
    .sort((a, b) => a.key.localeCompare(b.key));

afterEach(() => setAmbientParticleDensity(1));

describe("ambient site beats", () => {
  it("emits the same things at the same beats on two clients that joined apart", () => {
    const worldA = fakeWorld();
    const worldB = fakeWorld();
    populate(worldA);
    populate(worldB);
    const logA: Emission[] = [];
    const logB: Emission[] = [];
    const a = makeScheduler(worldA, logA);
    const b = makeScheduler(worldB, logB);
    // A arrives early on a steady 60fps; B arrives 7.3s later on a ragged
    // frame rate, standing three blocks away.
    run(a, worldA, new Vector3(0.5, 62, 0.5), 1000, 1040, () => 1 / 60);
    run(
      b,
      worldB,
      new Vector3(3.5, 62, -1.5),
      1007.3,
      1040,
      (frame) => [1 / 23, 1 / 71, 1 / 40, 0.09][frame % 4],
    );
    // Once B has swept its box (1s) and had a beat to start on.
    const fromA = settled(logA, 1010);
    const fromB = settled(logB, 1010);
    expect(fromA.length).toBeGreaterThan(100);
    expect(fromB.map((e) => e.key)).toEqual(fromA.map((e) => e.key));
    expect(fromB.map((e) => e.draws)).toEqual(fromA.map((e) => e.draws));
  });

  it("never replays a stall past its catch-up bound", () => {
    const site = { seed: 12345, phase: 0.2, lastBeat: Number.NaN };
    const out: number[] = [];
    planSiteBeats(site, 100, 0.5, 1, 3, out);
    expect(out).toEqual([]);
    expect(site.lastBeat).toBe(200);
    planSiteBeats(site, 110, 0.5, 1, 3, out);
    expect(out).toEqual([218, 219, 220]);
    out.length = 0;
    // A clock set back waits for its beat rather than replaying.
    planSiteBeats(site, 90, 0.5, 1, 3, out);
    expect(out).toEqual([]);
  });

  it("starts a placed block on its next beat and stops a broken one at once", () => {
    const world = fakeWorld();
    const log: Emission[] = [];
    const scheduler = makeScheduler(world, log, { emitChance: 1 });
    const center = new Vector3(0.5, 62, 0.5);
    run(scheduler, world, center, 50, 52, () => 1 / 60);
    expect(log).toEqual([]);

    world.set(2, 62, 2, EMITTER_ID);
    expect(scheduler.siteAt(2, 62, 2)).toBeDefined();
    run(scheduler, world, center, 52, 54, () => 1 / 60);
    expect(log.length).toBeGreaterThanOrEqual(3);

    world.set(2, 62, 2, 0);
    expect(scheduler.siteAt(2, 62, 2)).toBeUndefined();
    const before = log.length;
    run(scheduler, world, center, 54, 56, () => 1 / 60);
    expect(log.length).toBe(before);
  });

  it("rechecks a site when the block beside it changes", () => {
    const world = fakeWorld();
    const log: Emission[] = [];
    // A site only while the block under it is open.
    const scheduler = makeScheduler(world, log, {
      isSite: ({ vx, vy, vz }) => world.getVoxelAt(vx, vy - 1, vz) === 0,
    });
    world.set(1, 63, 1, EMITTER_ID);
    expect(scheduler.siteAt(1, 63, 1)).toBeDefined();
    world.set(1, 62, 1, COVER_ID);
    expect(scheduler.siteAt(1, 63, 1)).toBeUndefined();
    world.set(1, 62, 1, 0);
    expect(scheduler.siteAt(1, 63, 1)).toBeDefined();
  });

  it("caps emitters by a rank both clients share", () => {
    const worldA = fakeWorld();
    const worldB = fakeWorld();
    populate(worldA);
    populate(worldB);
    const logA: Emission[] = [];
    const logB: Emission[] = [];
    const a = makeScheduler(worldA, logA, {
      maxEmittingSites: 4,
      emitChance: 1,
    });
    const b = makeScheduler(worldB, logB, {
      maxEmittingSites: 4,
      emitChance: 1,
    });
    run(a, worldA, new Vector3(0.5, 62, 0.5), 10, 20, () => 1 / 60);
    run(b, worldB, new Vector3(-2.5, 61, 1.5), 12, 20, () => 1 / 30);
    const sitesOf = (log: Emission[]) =>
      [...new Set(settled(log, 14).map((e) => e.key.split("#")[0]))].sort();
    expect(sitesOf(logA)).toHaveLength(4);
    expect(sitesOf(logB)).toEqual(sitesOf(logA));
  });

  it("thins with the ambient density, and stops at zero", () => {
    const world = fakeWorld();
    populate(world);
    const log: Emission[] = [];
    const scheduler = makeScheduler(world, log);
    setAmbientParticleDensity(0);
    run(scheduler, world, new Vector3(0.5, 62, 0.5), 0, 10, () => 1 / 60);
    expect(log).toEqual([]);
  });

  it("finds every site in its box within the sweep time, without random probes", () => {
    const world = fakeWorld();
    const sites = populate(world);
    const scheduler = makeScheduler(world, [], { maxSweepPerFrame: 1000 });
    run(scheduler, world, new Vector3(0.5, 62, 0.5), 0, 1.05, () => 1 / 60);
    for (const [x, y, z] of sites)
      expect(scheduler.siteAt(x, y, z)).toBeDefined();
  });
});

describe("ambient block emitter", () => {
  it("keeps the rate its probe budget was tuned to", () => {
    // 2000 probes/s over a 28x20x28 box at 0.2: one leaf every ~39s.
    const leaves = beatScheduleForProbeRate({
      probesPerSecond: 2000,
      probeRadiusXZ: 14,
      probeRadiusY: 10,
      emitChance: 0.2,
    });
    expect(leaves.emitChance / leaves.beatSeconds).toBeCloseTo(
      (2000 / 15680) * 0.2,
      6,
    );
    // A fast emitter gets short beats rather than a certain chance.
    const torch = beatScheduleForProbeRate({
      probesPerSecond: 5760,
      probeRadiusXZ: 10,
      probeRadiusY: 6,
      emitChance: 1,
    });
    expect(torch.emitChance).toBeLessThanOrEqual(0.5);
    expect(torch.emitChance / torch.beatSeconds).toBeCloseTo(5760 / 4800, 6);
  });

  it("emits on shared beats through the probe-shaped options", () => {
    const worldA = fakeWorld();
    const worldB = fakeWorld();
    populate(worldA);
    populate(worldB);
    const keys = (world: FakeWorld, log: string[]) =>
      new AmbientBlockEmitter<string>(world, {
        label: "legacy",
        resolveSource: (b) => (b.id === EMITTER_ID ? "emitter" : null),
        probesPerSecond: 6000,
        probeRadiusXZ: 12,
        probeRadiusY: 8,
        maxProbesPerFrame: 100,
        emitChance: 0.5,
        emit: ({ vx, vy, vz, beat, random }) =>
          log.push(`${vx},${vy},${vz}#${beat}:${random().toFixed(6)}`),
      });
    const logA: string[] = [];
    const logB: string[] = [];
    const a = keys(worldA, logA);
    const b = keys(worldB, logB);
    a.prepare();
    b.prepare();
    const center = new Vector3(0.5, 62, 0.5);
    for (let t = 0; t < 30; t += 1 / 60) {
      worldA.clockValue = 500 + t;
      a.update(center, 1 / 60);
    }
    for (let t = 0; t < 30; t += 1 / 45) {
      worldB.clockValue = 500 + t;
      b.update(center, 1 / 45);
    }
    const late = (log: string[]) =>
      log.slice(Math.floor(log.length / 2)).sort();
    expect(logA.length).toBeGreaterThan(20);
    const shared = new Set(logA);
    expect(late(logB).every((entry) => shared.has(entry))).toBe(true);
  });
});
