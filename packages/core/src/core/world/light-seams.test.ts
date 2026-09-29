import { beforeAll, describe, expect, it } from "vitest";

import type { Coords3 } from "../../types";
import { BlockUtils, ChunkUtils, LightColor } from "../../utils";

import { Block, BlockRotation } from "./block";
import {
  analyzeLightOperations,
  buildLightJobs,
  floodLight,
  LightJob,
  LightWorkerResult,
  mergeSingleColorResult,
  ProcessedUpdate,
  removeLightsBatch,
  VoxelLightVolume,
  VoxelLightVolumeOptions,
} from "./lighting";
import { RawChunk, RawChunkOptions } from "./raw-chunk";
import { Registry } from "./registry";

/**
 * The client's whole relight path, end to end: an edit is analysed on the
 * main thread, split into light jobs with their bounding boxes, run through
 * the real light worker module on a snapshot of the chunks in each box, and
 * merged back through the box columns — then compared, voxel for voxel,
 * against the same world lit from scratch. A BFS light field is a pure
 * function of blocks and emitters, so any difference is a seam the player
 * would see until a reload.
 */

const AIR = 0;
const STONE = 1;
const TORCH = 2;
const DIM_LAMP = 3;
const SWITCH_LAMP = 4;
const WARM_LAMP = 5;

const TORCH_LEVEL = 15;
const DIM_LEVEL = 6;

const FLOOR_Y = 4;
const Y = FLOOR_Y + 1;

const CHUNK_OPTIONS: RawChunkOptions = {
  size: 16,
  maxHeight: 16,
  maxLightLevel: 15,
  subChunks: 2,
};

const VOLUME_OPTIONS: VoxelLightVolumeOptions = {
  chunkSize: CHUNK_OPTIONS.size,
  maxHeight: CHUNK_OPTIONS.maxHeight,
  maxLightLevel: CHUNK_OPTIONS.maxLightLevel,
  minChunk: [-3, -2],
  maxChunk: [3, 2],
};

const COLORS: LightColor[] = ["RED", "GREEN", "BLUE"];

const block = (id: number, name: string, props: Partial<Block> = {}): Block =>
  ({
    id,
    name,
    isOpaque: false,
    isTransparent: Array(6).fill(true),
    lightAttenuation: 0,
    isLight: false,
    redLightLevel: 0,
    greenLightLevel: 0,
    blueLightLevel: 0,
    rotatable: false,
    yRotatable: false,
    aabbs: [],
    ...props,
  }) as unknown as Block;

const lamp = (id: number, name: string, r: number, g: number, b: number) =>
  block(id, name, {
    isLight: true,
    redLightLevel: r,
    greenLightLevel: g,
    blueLightLevel: b,
  });

/** Lit at stage 1, dark at stage 0: a lamp its owner switches. */
const switchLamp = () =>
  block(SWITCH_LAMP, "Switch Lamp", {
    dynamicPatterns: [
      {
        parts: [
          {
            rule: {
              type: "simple",
              offset: [0, 0, 0],
              id: null,
              rotation: null,
              stage: 1,
            },
            aabbs: [],
            faces: [],
            isTransparent: Array(6).fill(true),
            redLightLevel: TORCH_LEVEL,
            greenLightLevel: TORCH_LEVEL,
            blueLightLevel: TORCH_LEVEL,
          },
          {
            rule: { type: "none" },
            aabbs: [],
            faces: [],
            isTransparent: Array(6).fill(true),
            redLightLevel: 0,
            greenLightLevel: 0,
            blueLightLevel: 0,
          },
        ],
      },
    ],
  } as unknown as Partial<Block>);

const BLOCKS: Block[] = [
  block(AIR, "Air"),
  block(STONE, "Stone", {
    isOpaque: true,
    isTransparent: [false, false, false, false, false, false],
  }),
  lamp(TORCH, "Torch", TORCH_LEVEL, TORCH_LEVEL - 1, TORCH_LEVEL - 4),
  lamp(DIM_LAMP, "Dim Lamp", DIM_LEVEL, DIM_LEVEL, DIM_LEVEL),
  switchLamp(),
  lamp(WARM_LAMP, "Warm Lamp", 12, 7, 2),
];

const registry = new Registry();
for (const b of BLOCKS) {
  registry.blocksById.set(b.id, b);
  registry.blocksByName.set(b.name, b);
  registry.nameMap.set(b.name, b.id);
  registry.idMap.set(b.id, b.name);
}

type WorkerMessage = { data: Record<string, unknown> };
let runWorker: (message: Record<string, unknown>) => LightWorkerResult;

beforeAll(async () => {
  // The worker module installs a global `onmessage` and answers through
  // `postMessage`; drive the real module in-process.
  const scope = globalThis as unknown as {
    onmessage: ((event: WorkerMessage) => void) | null;
    postMessage: (message: unknown) => void;
  };
  let reply: LightWorkerResult | null = null;
  scope.onmessage = null;
  scope.postMessage = (message) => {
    reply = message as LightWorkerResult;
  };
  await import("./workers/light-worker");
  const handler = scope.onmessage as unknown as (event: WorkerMessage) => void;
  handler({ data: { type: "init", registryData: registry.serialize() } });
  runWorker = (message) => {
    reply = null;
    handler({ data: message });
    if (!reply) throw new Error("light worker did not answer");
    return reply;
  };
});

/** A walled-off slab of chunks: a stone floor, air above, no sunlight. */
class ClientWorld implements VoxelLightVolume {
  options = VOLUME_OPTIONS;
  chunks = new Map<string, RawChunk>();

  constructor() {
    const { size, maxHeight } = CHUNK_OPTIONS;
    const [minCX, minCZ] = VOLUME_OPTIONS.minChunk;
    const [maxCX, maxCZ] = VOLUME_OPTIONS.maxChunk;
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const chunk = new RawChunk(`${cx}|${cz}`, [cx, cz], CHUNK_OPTIONS);
        chunk.voxels.data = new Uint32Array(size * maxHeight * size);
        chunk.lights.data = new Uint32Array(size * maxHeight * size);
        this.chunks.set(ChunkUtils.getChunkName([cx, cz]), chunk);
        for (let x = 0; x < size; x++) {
          for (let z = 0; z < size; z++) {
            chunk.setVoxel(cx * size + x, FLOOR_Y, cz * size + z, STONE);
          }
        }
      }
    }
  }

  chunkAt(vx: number, vz: number) {
    const coords = ChunkUtils.mapVoxelToChunk([vx, 0, vz], CHUNK_OPTIONS.size);
    return this.chunks.get(ChunkUtils.getChunkName(coords));
  }

  getBlockAt(x: number, y: number, z: number) {
    return registry.blocksById.get(this.getVoxelAt(x, y, z)) ?? null;
  }
  getVoxelAt(x: number, y: number, z: number) {
    return this.chunkAt(x, z)?.getVoxel(x, y, z) ?? AIR;
  }
  getVoxelRotationAt(x: number, y: number, z: number) {
    return this.chunkAt(x, z)?.getVoxelRotation(x, y, z) ?? new BlockRotation();
  }
  getVoxelStageAt(x: number, y: number, z: number) {
    return this.chunkAt(x, z)?.getVoxelStage(x, y, z) ?? 0;
  }
  getSunlightAt(x: number, y: number, z: number) {
    return this.chunkAt(x, z)?.getSunlight(x, y, z) ?? 0;
  }
  setSunlightAt(x: number, y: number, z: number, level: number) {
    this.chunkAt(x, z)?.setSunlight(x, y, z, level);
  }
  getTorchLightAt(x: number, y: number, z: number, color: LightColor) {
    return this.chunkAt(x, z)?.getTorchLight(x, y, z, color) ?? 0;
  }
  setTorchLightAt(
    x: number,
    y: number,
    z: number,
    level: number,
    color: LightColor,
  ) {
    this.chunkAt(x, z)?.setTorchLight(x, y, z, level, color);
  }

  /** Writes the blocks and returns what the main thread hands the analysis. */
  private write(
    edits: { voxel: Coords3; id: number; stage?: number }[],
  ): ProcessedUpdate[] {
    return edits.map(({ voxel, id, stage = 0 }) => {
      const [x, y, z] = voxel;
      const chunk = this.chunkAt(x, z);
      if (!chunk) throw new Error(`edit outside the world at ${voxel}`);
      const oldId = this.getVoxelAt(x, y, z);
      const oldStage = this.getVoxelStageAt(x, y, z);
      const rotation = new BlockRotation();
      chunk.setVoxel(x, y, z, id);
      chunk.setVoxelStage(x, y, z, stage);
      return {
        voxel,
        oldId,
        newId: id,
        oldBlock: registry.blocksById.get(oldId)!,
        newBlock: registry.blocksById.get(id)!,
        oldRotation: rotation,
        newRotation: rotation,
        oldStage,
        stage,
      };
    });
  }

  /** One batch through the light workers, as World.processLightUpdates runs it. */
  edit(edits: { voxel: Coords3; id: number; stage?: number }[]) {
    const ops = analyzeLightOperations(this, this.write(edits));
    if (!ops.hasOperations) return;

    let jobCount = 0;
    const jobs = buildLightJobs(
      ops,
      0,
      0,
      VOLUME_OPTIONS,
      (color) => `${color}-${jobCount++}`,
    );

    // Every job of a batch reads the chunks as they stood when the batch
    // started; results only land once the whole batch is back.
    const messages = jobs.map((job) => this.jobMessage(job));
    const results = messages.map((message) => runWorker(message));

    results.forEach((result, index) => {
      const job = jobs[index];
      expect(result.pendingFloods ?? []).toEqual([]);
      expect(result.pendingRemovals ?? []).toEqual([]);
      for (const { coords, lights } of result.modifiedChunks) {
        const chunk = this.chunks.get(ChunkUtils.getChunkName(coords));
        if (!chunk) continue;
        mergeSingleColorResult(
          chunk as unknown as Parameters<typeof mergeSingleColorResult>[0],
          lights as Uint32Array,
          job.color,
          job.boundingBox,
        );
      }
    });
  }

  /** Mirrors World.executeLightJob's chunk grid for a job's box. */
  private jobMessage(job: LightJob) {
    const { min, shape } = job.boundingBox;
    const { chunkSize } = VOLUME_OPTIONS;
    const minCX = Math.floor(min[0] / chunkSize);
    const minCZ = Math.floor(min[2] / chunkSize);
    const maxCX = Math.floor((min[0] + shape[0] - 1) / chunkSize);
    const maxCZ = Math.floor((min[2] + shape[2] - 1) / chunkSize);

    const chunksData: (object | null)[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const chunk = this.chunks.get(ChunkUtils.getChunkName([cx, cz]));
        chunksData.push(
          chunk
            ? {
                id: chunk.id,
                x: cx,
                z: cz,
                voxels: new Uint32Array(chunk.voxels.data).buffer,
                lights: new Uint32Array(chunk.lights.data).buffer,
                transferMode: "transfer",
                options: CHUNK_OPTIONS,
              }
            : null,
        );
      }
    }

    return {
      type: "batchOperations",
      jobId: job.jobId,
      color: job.color,
      boundingBox: job.boundingBox,
      chunksData,
      chunkGridDimensions: [maxCX - minCX + 1, maxCZ - minCZ + 1],
      chunkGridOffset: [minCX, minCZ],
      relevantDeltas: {},
      lightOps: job.lightOps,
      options: { ...VOLUME_OPTIONS, subChunks: CHUNK_OPTIONS.subChunks },
    };
  }

  /** Every voxel of the world, lit again from nothing but its emitters. */
  relitFromScratch(): ClientWorld {
    const fresh = new ClientWorld();
    for (const [name, chunk] of this.chunks) {
      fresh.chunks.get(name)!.voxels.data.set(chunk.voxels.data);
    }
    for (const color of COLORS) {
      const seeds = fresh.emitters(color);
      for (const { voxel, level } of seeds) {
        fresh.setTorchLightAt(...voxel, level, color);
      }
      floodLight(fresh, seeds, color);
    }
    return fresh;
  }

  emitters(color: LightColor) {
    const seeds: { voxel: Coords3; level: number }[] = [];
    const access = {
      getVoxelAt: (x: number, y: number, z: number) => this.getVoxelAt(x, y, z),
      getVoxelRotationAt: (x: number, y: number, z: number) =>
        this.getVoxelRotationAt(x, y, z),
      getVoxelStageAt: (x: number, y: number, z: number) =>
        this.getVoxelStageAt(x, y, z),
    };
    this.forEachVoxel((x, y, z) => {
      const b = this.getBlockAt(x, y, z);
      if (!b) return;
      const level = BlockUtils.getBlockTorchLightLevelAt(
        b,
        color,
        [x, y, z],
        access,
      );
      if (level > 0) seeds.push({ voxel: [x, y, z], level });
    });
    return seeds;
  }

  forEachVoxel(visit: (x: number, y: number, z: number) => void) {
    const { size, maxHeight } = CHUNK_OPTIONS;
    for (const chunk of this.chunks.values()) {
      const [x0, , z0] = chunk.min;
      for (let x = x0; x < x0 + size; x++) {
        for (let y = 0; y < maxHeight; y++) {
          for (let z = z0; z < z0 + size; z++) visit(x, y, z);
        }
      }
    }
  }
}

/** Every voxel whose light differs from a from-scratch relight. */
const seamsIn = (world: ClientWorld) => {
  const truth = world.relitFromScratch();
  const seams: string[] = [];
  world.forEachVoxel((x, y, z) => {
    for (const color of COLORS) {
      const got = world.getTorchLightAt(x, y, z, color);
      const want = truth.getTorchLightAt(x, y, z, color);
      if (got !== want) seams.push(`${color} (${x},${y},${z}) ${got}≠${want}`);
    }
  });
  return seams;
};

const expectNoSeams = (world: ClientWorld) => {
  const seams = seamsIn(world);
  expect(seams.slice(0, 8), `${seams.length} voxel(s) off`).toEqual([]);
};

describe("client relight across job boxes and chunk borders", () => {
  it("breaking one of two torches 17 apart leaves the other's light whole", () => {
    // The in-game repro: torches 17 blocks apart on one floor, the far one
    // broken. Its job box is ±15 around it, so the near torch sits just
    // outside the box that its field gets merged through.
    const world = new ClientWorld();
    world.edit([{ voxel: [-1, Y, 0], id: TORCH }]);
    world.edit([{ voxel: [16, Y, 0], id: TORCH }]);
    expectNoSeams(world);

    world.edit([{ voxel: [16, Y, 0], id: AIR }]);
    expectNoSeams(world);
    // One block past the box edge, the near torch's light still falls off
    // one step at a time instead of stopping dead.
    expect(world.getTorchLightAt(0, Y, 0, "RED")).toBe(TORCH_LEVEL - 1);
    expect(world.getTorchLightAt(1, Y, 0, "RED")).toBe(TORCH_LEVEL - 2);
  });

  it("placing a torch in a lamp's glow does not cut a farther lamp off on the box edge", () => {
    // The glowberry case: a new torch's cell is cleared of the light it held
    // before it is lit, which is a removal of that light's colour. Two warm
    // lamps' fields touch; the second lamp stands outside the torch's box.
    const world = new ClientWorld();
    world.edit([{ voxel: [8, Y, 0], id: WARM_LAMP }]);
    world.edit([{ voxel: [20, Y, 1], id: WARM_LAMP }]);
    expectNoSeams(world);

    world.edit([{ voxel: [0, Y, 0], id: TORCH }]);
    expectNoSeams(world);
  });

  it("a chain of torches loses exactly the broken one's light", () => {
    const world = new ClientWorld();
    for (const x of [-40, -28, -16, -4, 8, 20, 32]) {
      world.edit([{ voxel: [x, Y, 1], id: TORCH }]);
    }
    expectNoSeams(world);
    world.edit([{ voxel: [8, Y, 1], id: AIR }]);
    expectNoSeams(world);
    world.edit([{ voxel: [-28, Y, 1], id: AIR }]);
    expectNoSeams(world);
  });

  it("a dim lamp beside a bright one keeps shining when the bright one goes", () => {
    const world = new ClientWorld();
    world.edit([{ voxel: [15, Y, 15], id: DIM_LAMP }]);
    world.edit([{ voxel: [16, Y, 15], id: TORCH }]);
    expect(world.getTorchLightAt(15, Y, 15, "RED")).toBe(TORCH_LEVEL - 1);

    world.edit([{ voxel: [16, Y, 15], id: AIR }]);
    expect(world.getTorchLightAt(15, Y, 15, "RED")).toBe(DIM_LEVEL);
    expect(world.getTorchLightAt(17, Y, 15, "RED")).toBe(DIM_LEVEL - 2);
    expectNoSeams(world);
  });

  it("a row of switched lamps goes dark together and one at a time", () => {
    const row: Coords3[] = [-2, -1, 0, 1, 2].map((x) => [x, Y, -1]);
    const world = new ClientWorld();
    world.edit(row.map((voxel) => ({ voxel, id: SWITCH_LAMP, stage: 1 })));
    expectNoSeams(world);

    // One at a time: each switched-off lamp's neighbours still shine.
    world.edit([{ voxel: row[2], id: SWITCH_LAMP, stage: 0 }]);
    expectNoSeams(world);
    world.edit([{ voxel: row[0], id: SWITCH_LAMP, stage: 0 }]);
    expectNoSeams(world);

    // Back on, then the whole row off in one packet.
    world.edit(row.map((voxel) => ({ voxel, id: SWITCH_LAMP, stage: 1 })));
    expectNoSeams(world);
    world.edit(row.map((voxel) => ({ voxel, id: SWITCH_LAMP, stage: 0 })));
    expectNoSeams(world);
    expect(world.getTorchLightAt(0, Y, -1, "RED")).toBe(0);
  });

  it("random torch and stone edits across chunk borders never leave a seam", () => {
    // A seeded walk of places and breaks around the chunk corner at the
    // origin: torches, lamps, and stone walls that cut fields apart. Around
    // the origin is deliberate: the worker's caches once keyed chunks and
    // voxels on a lossy hash, and chunk (-1,-1) collided with (1,1).
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];

    const world = new ClientWorld();
    const ids = [TORCH, TORCH, WARM_LAMP, DIM_LAMP, STONE, STONE, AIR, AIR];
    for (let step = 0; step < 40; step++) {
      const voxel: Coords3 = [
        Math.floor(random() * 40) - 20,
        Y + Math.floor(random() * 3),
        Math.floor(random() * 24) - 12,
      ];
      const id = pick(ids);
      world.edit([{ voxel, id }]);
      const seams = seamsIn(world);
      expect(
        seams.slice(0, 4),
        `step ${step}: ${id} at ${voxel}, ${seams.length} voxel(s) off`,
      ).toEqual([]);
    }
  });
});

describe("main-thread removeLightsBatch", () => {
  it("reseeds a dim lamp the removal front zeroed", () => {
    const world = new ClientWorld();
    world.edit([{ voxel: [3, Y, 3], id: DIM_LAMP }]);
    world.edit([{ voxel: [4, Y, 3], id: TORCH }]);

    world.chunkAt(4, 3)!.setVoxel(4, Y, 3, AIR);
    for (const color of COLORS) {
      removeLightsBatch(world, [[4, Y, 3]], color);
    }
    expect(world.getTorchLightAt(3, Y, 3, "RED")).toBe(DIM_LEVEL);
    expectNoSeams(world);
  });

  it("stops at light that belongs to another torch", () => {
    const world = new ClientWorld();
    world.edit([{ voxel: [-1, Y, 0], id: TORCH }]);
    world.edit([{ voxel: [16, Y, 0], id: TORCH }]);

    world.chunkAt(16, 0)!.setVoxel(16, Y, 0, AIR);
    for (const color of COLORS) {
      removeLightsBatch(world, [[16, Y, 0]], color);
    }
    expectNoSeams(world);
  });
});
