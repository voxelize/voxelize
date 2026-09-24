import { describe, expect, it } from "vitest";

import { BorderSwapHold, HeldMeshResult } from "./border-swap-hold";
import { MeshPipeline } from "./pipelines";

const result = (
  cx: number,
  cz: number,
  level: number,
  heldAt = 0,
): HeldMeshResult<string> => ({
  cx,
  cz,
  level,
  geometries: `${cx},${cz}:${level}`,
  connectivity: 0,
  generation: 1,
  heldAt,
});

describe("BorderSwapHold", () => {
  it("hands back only the results of the eight chunks around a chunk", () => {
    const hold = new BorderSwapHold<string>();
    hold.hold(result(0, 0, 0));
    hold.hold(result(1, 1, 2));
    hold.hold(result(2, 0, 0));
    hold.hold(result(-1, 0, 1));

    const taken = hold.takeAround(0, 0).map((r) => r.geometries);
    expect(taken.sort()).toEqual(["-1,0:1", "1,1:2"]);
    expect(hold.size).toBe(2);
  });

  it("keeps only the newest result per section, and forgets unloaded chunks", () => {
    const hold = new BorderSwapHold<string>();
    hold.hold({ ...result(1, 0, 0), generation: 1 });
    hold.hold({ ...result(1, 0, 0), generation: 3 });
    expect(hold.size).toBe(1);
    expect(hold.takeAround(0, 0)[0].generation).toBe(3);

    hold.hold(result(1, 0, 0));
    hold.hold(result(1, 0, 1));
    hold.dropChunk(1, 0);
    expect(hold.size).toBe(0);
  });

  it("gives up results held past the bound", () => {
    const hold = new BorderSwapHold<string>();
    hold.hold(result(1, 0, 0, 100));
    hold.hold(result(2, 0, 0, 900));
    expect(hold.takeOlderThan(1000, 500).map((r) => r.cx)).toEqual([1]);
    expect(hold.size).toBe(1);
  });
});

/**
 * A render disc streaming in through the real MeshPipeline with the World's
 * scheduling around it: every arriving chunk re-queues its ready neighbours
 * (`markChunkAndNeighborsForMeshing`), and dispatch runs batches of one job
 * per worker, each awaited whole, the next starting two frames later
 * (`processDirtyChunks`). Time is in frames.
 *
 * A border gap is a re-mesh swapped in (the wall it drew against a missing
 * chunk comes down) while the chunk whose arrival asked for it still has a
 * section with nothing on screen: the frames through which whatever is
 * behind that border shows through.
 */
/** `before` swaps every re-mesh in on arrival; `held` is the World now. */
type Policy = "before" | "held";

type Scenario = {
  radius: number;
  levels: number;
  arrivalsPerFrame: number;
  heldShare: number;
  heldFrames: [number, number];
  workers: number;
  jobFrames: [number, number];
  seed: number;
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function stream(policy: Policy, scenario: Scenario) {
  const random = mulberry32(scenario.seed);
  const between = ([low, high]: [number, number]) =>
    low + Math.floor(random() * (high - low + 1));

  const disc: [number, number][] = [];
  for (let x = -scenario.radius; x <= scenario.radius; x++) {
    for (let z = -scenario.radius; z <= scenario.radius; z++) {
      if (x * x + z * z <= scenario.radius ** 2) disc.push([x, z]);
    }
  }
  disc.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
  const arrivals = new Map<number, [number, number][]>();
  let lastArrival = 0;
  disc.forEach((coords, index) => {
    let frame = Math.floor(index / scenario.arrivalsPerFrame);
    if (random() < scenario.heldShare) frame += between(scenario.heldFrames);
    lastArrival = Math.max(lastArrival, frame);
    arrivals.set(frame, [...(arrivals.get(frame) ?? []), coords]);
  });

  const pipeline = new MeshPipeline();
  const hold = new BorderSwapHold<Set<string>>();
  const levels = [...Array(scenario.levels).keys()];
  const loaded = new Set<string>();
  const causes = new Map<string, Set<string>>();
  const isShown = (cx: number, cz: number) =>
    levels.every((level) =>
      pipeline.hasDisplayed(MeshPipeline.makeKey(cx, cz, level)),
    );
  const hasUnshownNeighbor = (cx: number, cz: number) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (loaded.has(`${cx + dx},${cz + dz}`) && !isShown(cx + dx, cz + dz)) {
          return true;
        }
      }
    }
    return false;
  };

  let jobs = 0;
  let borderGaps = 0;
  let maxHeld = 0;
  const shownAt = new Map<string, number>();
  let batch: {
    key: string;
    generation: number;
    doneAt: number;
    covers: Set<string>;
  }[] = [];
  let nextDispatchAt = 0;
  let frame = 0;

  const land = (key: string, generation: number, covers: Set<string>) => {
    const { cx, cz } = MeshPipeline.parseKey(key);
    if (
      policy === "held" &&
      pipeline.hasDisplayed(key) &&
      hasUnshownNeighbor(cx, cz)
    ) {
      const { level } = MeshPipeline.parseKey(key);
      hold.hold({
        cx,
        cz,
        level,
        geometries: covers,
        connectivity: 0,
        generation,
        heldAt: frame,
      });
      maxHeld = Math.max(maxHeld, hold.size);
      return;
    }
    // Only a mesh replacing one on screen can take a wall down; a first mesh
    // has nothing drawn to open.
    const wasShown = pipeline.hasDisplayed(key);
    const accepted = pipeline.onJobComplete(key, generation);
    if (!accepted) {
      const owed = causes.get(key) ?? new Set<string>();
      covers.forEach((name) => owed.add(name));
      causes.set(key, owed);
      return;
    }
    if (wasShown) {
      for (const name of covers) {
        const [nx, nz] = name.split(",").map(Number);
        if (!isShown(nx, nz)) borderGaps += 1;
      }
    }
    const name = `${cx},${cz}`;
    if (!shownAt.has(name) && isShown(cx, cz)) {
      shownAt.set(name, frame);
      for (const parked of hold.takeAround(cx, cz)) {
        land(
          MeshPipeline.makeKey(parked.cx, parked.cz, parked.level),
          parked.generation,
          parked.geometries,
        );
      }
    }
  };

  for (; frame < 50_000; frame++) {
    for (const [cx, cz] of arrivals.get(frame) ?? []) {
      loaded.add(`${cx},${cz}`);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!loaded.has(`${cx + dx},${cz + dz}`)) continue;
          for (const level of levels) {
            pipeline.onVoxelChange(cx + dx, cz + dz, level);
            if (dx === 0 && dz === 0) continue;
            const key = MeshPipeline.makeKey(cx + dx, cz + dz, level);
            const owed = causes.get(key) ?? new Set<string>();
            owed.add(`${cx},${cz}`);
            causes.set(key, owed);
          }
        }
      }
    }

    if (batch.length > 0 && batch.every((job) => job.doneAt <= frame)) {
      for (const job of batch) land(job.key, job.generation, job.covers);
      batch = [];
      nextDispatchAt = frame + 2;
    }

    if (batch.length === 0 && frame >= nextDispatchAt) {
      for (const key of pipeline
        .getDirtyKeys([0, 0])
        .slice(0, scenario.workers)) {
        const covers = causes.get(key) ?? new Set<string>();
        causes.delete(key);
        batch.push({
          key,
          generation: pipeline.startJob(key),
          doneAt: frame + between(scenario.jobFrames),
          covers,
        });
        jobs += 1;
      }
    }

    if (
      frame > lastArrival &&
      batch.length === 0 &&
      !pipeline.hasDirtyChunks() &&
      hold.size === 0
    ) {
      break;
    }
  }

  let staleAtEnd = 0;
  for (const [cx, cz] of disc) {
    for (const level of levels) {
      if (pipeline.needsRemesh(MeshPipeline.makeKey(cx, cz, level))) {
        staleAtEnd += 1;
      }
    }
  }
  return {
    borderGaps,
    jobs,
    visibleFill: Math.max(...shownAt.values()),
    maxHeld,
    heldAtEnd: hold.size,
    staleAtEnd,
    settled: frame,
  };
}

const BASE: Scenario = {
  radius: 8,
  levels: 3,
  arrivalsPerFrame: 0.5,
  heldShare: 0.25,
  heldFrames: [6, 30],
  workers: 4,
  jobFrames: [1, 3],
  seed: 11,
};

const SCENARIOS: Record<string, Scenario> = {
  "server-bound (30 chunks/s)": BASE,
  "slow server, held chunks (15 chunks/s)": {
    ...BASE,
    arrivalsPerFrame: 0.25,
    heldShare: 0.4,
  },
  "loaded client (slow meshing)": {
    ...BASE,
    arrivalsPerFrame: 1,
    jobFrames: [3, 9],
  },
};

describe("frontier borders while a render disc streams in", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(`${name}: no border opens before what covers it is drawn`, () => {
      const before = stream("before", scenario);
      const held = stream("held", scenario);
      console.log(`[border-gaps] ${name}`, JSON.stringify({ before, held }));

      expect(before.borderGaps).toBeGreaterThan(0);
      expect(held.borderGaps).toBe(0);
      expect(held.heldAtEnd).toBe(0);
      expect(held.staleAtEnd).toBe(0);
      expect(before.staleAtEnd).toBe(0);
      // Holding the swap back must not slow new terrain or add work.
      expect(held.visibleFill).toBeLessThanOrEqual(before.visibleFill);
      expect(held.jobs).toBeLessThanOrEqual(before.jobs * 1.01);
    });
  }
});
