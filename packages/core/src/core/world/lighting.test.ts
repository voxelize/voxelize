import { describe, expect, it } from "vitest";

import { Coords3 } from "../../types";
import { LightColor, LightUtils } from "../../utils";

import { Block, BlockRotation } from "./block";
import {
  analyzeLightOperations,
  buildLightJobs,
  countLightSeeds,
  floodLight,
  foldLightJobsBack,
  LightJob,
  LightOperations,
  VoxelLightVolume,
  VoxelLightVolumeOptions,
} from "./lighting";

const options: VoxelLightVolumeOptions = {
  chunkSize: 16,
  maxHeight: 256,
  maxLightLevel: 15,
  minChunk: [-8, -8],
  maxChunk: [8, 8],
};

/**
 * Seeds far enough apart to land in several clusters, so the jobs really do
 * partition the work rather than carry it whole.
 */
const scattered: LightOperations = {
  removals: {
    sunlight: [
      [1, 2, 3],
      [60, 2, 3],
      [61, 3, 3],
    ],
    red: [[5, 5, 5]],
    green: [],
    blue: [[-40, 10, 7]],
  },
  floods: {
    sunlight: [
      { voxel: [1, 3, 3], level: 15 },
      { voxel: [-70, 9, 40], level: 12 },
    ],
    red: [],
    green: [{ voxel: [7, 7, 7], level: 9 }],
    blue: [{ voxel: [-40, 11, 7], level: 4 }],
  },
  hasOperations: true,
};

/** Order-free view of an operation set, since clustering reorders seeds. */
const normalized = (ops: LightOperations) => {
  const sortJson = <T>(items: T[]) =>
    items.map((item) => JSON.stringify(item)).sort();
  return {
    removals: {
      sunlight: sortJson(ops.removals.sunlight),
      red: sortJson(ops.removals.red),
      green: sortJson(ops.removals.green),
      blue: sortJson(ops.removals.blue),
    },
    floods: {
      sunlight: sortJson(ops.floods.sunlight),
      red: sortJson(ops.floods.red),
      green: sortJson(ops.floods.green),
      blue: sortJson(ops.floods.blue),
    },
  };
};

const jobsFor = (ops: LightOperations): LightJob[] => {
  let counter = 0;
  return buildLightJobs(ops, 0, 1, options, (color) => `${color}-${counter++}`);
};

/** Fold, and fail the test loudly if nothing came back. */
const foldOrFail = (
  accumulated: LightOperations | null,
  jobs: LightJob[],
): LightOperations => {
  const folded = foldLightJobsBack(accumulated, jobs);
  if (folded === null) {
    throw new Error("expected folded light operations, got null");
  }
  return folded;
};

describe("foldLightJobsBack", () => {
  it("gives back every seed the jobs were built from, per color", () => {
    const jobs = jobsFor(scattered);
    expect(jobs.length).toBeGreaterThan(1);

    const folded = foldOrFail(null, jobs);

    expect(folded.hasOperations).toBe(true);
    expect(countLightSeeds(folded)).toBe(countLightSeeds(scattered));
    expect(normalized(folded)).toEqual(normalized(scattered));
  });

  it("joins work that was still accumulating instead of replacing it", () => {
    const accumulating: LightOperations = {
      removals: { sunlight: [[100, 1, 100]], red: [], green: [], blue: [] },
      floods: {
        sunlight: [],
        red: [{ voxel: [100, 2, 100], level: 3 }],
        green: [],
        blue: [],
      },
      hasOperations: true,
    };

    const folded = foldOrFail(accumulating, jobsFor(scattered));

    expect(countLightSeeds(folded)).toBe(
      countLightSeeds(accumulating) + countLightSeeds(scattered),
    );
    expect(folded.removals.sunlight).toEqual(
      expect.arrayContaining([
        [100, 1, 100],
        [1, 2, 3],
      ]),
    );
    expect(folded.floods.red).toEqual([{ voxel: [100, 2, 100], level: 3 }]);
    // The caller's own set is left as it was.
    expect(accumulating.removals.sunlight).toEqual([[100, 1, 100]]);
  });

  it("leaves the accumulation alone when there is nothing to fold", () => {
    expect(foldLightJobsBack(null, [])).toBeNull();
    expect(foldLightJobsBack(scattered, [])).toBe(scattered);
  });

  it("survives a full shed-and-rebuild round trip unchanged", () => {
    // Shed, rebuild, shed again: what a page under sustained pressure does
    // every cooldown. The seeds must be the same set every time around.
    const once = foldOrFail(null, jobsFor(scattered));
    const twice = foldOrFail(null, jobsFor(once));

    expect(normalized(twice)).toEqual(normalized(scattered));
    expect(jobsFor(twice).length).toBe(jobsFor(scattered).length);
  });
});

/**
 * The narrowest block the lighting analysis can read: opacity, per-face
 * transparency, no attenuation, no emission.
 */
const makeBlock = (id: number, isOpaque: boolean): Block =>
  ({
    id,
    name: isOpaque ? "Stone" : "Air",
    isOpaque,
    isTransparent: Array(6).fill(!isOpaque),
    lightAttenuation: 0,
    isLight: false,
    redLightLevel: 0,
    greenLightLevel: 0,
    blueLightLevel: 0,
    rotatable: false,
    yRotatable: false,
  }) as unknown as Block;

const AIR = makeBlock(0, false);
const STONE = makeBlock(1, true);

/** A tiny world: a map of voxels and a map of sunlight, air everywhere else. */
class MemoryVolume implements VoxelLightVolume {
  options: VoxelLightVolumeOptions = {
    chunkSize: 16,
    maxHeight: 64,
    maxLightLevel: 15,
    minChunk: [-1, -1],
    maxChunk: [1, 1],
  };

  private voxels = new Map<string, number>();
  private sunlight = new Map<string, number>();

  private key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, block: Block, sun: number) {
    this.voxels.set(this.key(x, y, z), block.id);
    this.sunlight.set(this.key(x, y, z), sun);
  }

  getBlockAt(x: number, y: number, z: number): Block | null {
    return this.getVoxelAt(x, y, z) === STONE.id ? STONE : AIR;
  }

  getVoxelAt(x: number, y: number, z: number): number {
    return this.voxels.get(this.key(x, y, z)) ?? AIR.id;
  }

  getVoxelRotationAt(): BlockRotation {
    return BlockRotation.encode(0, 0);
  }

  getVoxelStageAt(): number {
    return 0;
  }

  getSunlightAt(x: number, y: number, z: number): number {
    return this.sunlight.get(this.key(x, y, z)) ?? 0;
  }

  setSunlightAt(x: number, y: number, z: number, level: number): void {
    this.sunlight.set(this.key(x, y, z), level);
  }

  getTorchLightAt(): number {
    return 0;
  }

  setTorchLightAt(): void {
    // Sunlight-only scene.
  }
}

describe("opening a cell whose lit neighbour has not been re-lit yet", () => {
  // The pit: a stone plinth with its top course and the pit cut in the same
  // packet. The plinth-top cell above the pit has already been turned to air
  // but its own flood is still on a worker, so on the main thread it reads
  // sunlight 0 — exactly what the analysis sees for the pit cell's only
  // possible source of light.
  const pit: Coords3 = [4, 2, 4];
  const above: Coords3 = [4, 3, 4];

  const sceneAtAnalysis = () => {
    const world = new MemoryVolume();
    for (const [x, y, z] of [
      [3, 2, 4],
      [5, 2, 4],
      [4, 2, 3],
      [4, 2, 5],
      [4, 1, 4],
    ] as Coords3[]) {
      world.set(x, y, z, STONE, 0);
    }
    world.set(...above, AIR, 0);
    world.set(...pit, AIR, 0);
    return world;
  };

  const openThePit = (world: VoxelLightVolume) =>
    analyzeLightOperations(world, [
      {
        voxel: pit,
        oldId: STONE.id,
        newId: AIR.id,
        oldBlock: STONE,
        newBlock: AIR,
        oldRotation: BlockRotation.encode(0, 0),
        newRotation: BlockRotation.encode(0, 0),
        oldStage: 0,
        stage: 0,
      },
    ]);

  it("finds no lit neighbour on the main thread and still leaves a seed", () => {
    const ops = openThePit(sceneAtAnalysis());

    // Nothing around the pit reads lit yet, so the immediate seeds would be
    // empty — the deferred one is what keeps the cell from being forgotten.
    expect(ops.hasOperations).toBe(true);
    expect(ops.floods.sunlight).toEqual([
      { voxel: pit, level: LightUtils.LEVEL_FROM_NEIGHBORS },
    ]);
  });

  it("resolves that seed where the flood runs and lights the cell", () => {
    const ops = openThePit(sceneAtAnalysis());

    // By the time the flood runs, the earlier batch has landed: the cell
    // above the pit is lit in the flood's snapshot.
    const snapshot = sceneAtAnalysis();
    snapshot.setSunlightAt(...above, 15);

    const seeds = LightUtils.resolveDeferredSeeds(
      snapshot,
      ops.floods.sunlight,
      "SUNLIGHT" as LightColor,
      snapshot.options.maxHeight,
    );
    expect(seeds).toEqual([{ voxel: above, level: 15 }]);

    floodLight(snapshot, seeds, "SUNLIGHT");
    expect(snapshot.getSunlightAt(...pit)).toBe(15);
  });

  it("passes ordinary seeds through and collapses duplicates", () => {
    const snapshot = sceneAtAnalysis();
    snapshot.setSunlightAt(...above, 15);

    const seeds = LightUtils.resolveDeferredSeeds(
      snapshot,
      [
        { voxel: pit, level: LightUtils.LEVEL_FROM_NEIGHBORS },
        { voxel: pit, level: LightUtils.LEVEL_FROM_NEIGHBORS },
        { voxel: above, level: 15 },
        { voxel: [9, 9, 9], level: 7 },
      ],
      "SUNLIGHT" as LightColor,
      snapshot.options.maxHeight,
    );

    expect(seeds).toEqual([
      { voxel: above, level: 15 },
      { voxel: [9, 9, 9], level: 7 },
    ]);
  });
});
