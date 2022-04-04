import { ChunkUtils } from "@voxelize/common";
import { Pool, spawn, Transfer } from "threads";

import { Chunk } from "./chunk";
import { Space } from "./space";
import {
  TesterType,
  TestWorker,
  HeightMapperType,
  HeightMapWorker,
  LightMesherType,
  LightMeshWorker,
} from "./workers";
import { World } from "./world";

/**
 * A stage in the chunk pipeline.
 */
abstract class ChunkStage {
  abstract name: string;

  /**
   * Gets run to see if a chunk should propagate to the next
   * stage. True, then proceed, vice versa.
   *
   * @returns Whether or not if chunk can proceed to stage
   */
  abstract check: (chunk: Chunk, world: World) => boolean;

  /**
   * Gets run every system tick, processes through chunk
   * queue to do whatever this stage does.
   *
   * @returns Asynchronously, an array of chunks that are
   * ready to be pushed to the next stage.
   */
  abstract process: (chunk: Chunk, world: World, args: any) => Promise<Chunk>;
}

/**
 * A chunk pipeline stage for testing that sets voxels into holes on the ground randomly.
 *
 * @extends {ChunkStage}
 */
class TestVoxelStage extends ChunkStage {
  name = "TestVoxel";

  private pool = Pool(() => spawn<TesterType>(TestWorker()));

  check = () => true;

  process = async (chunk: Chunk, world: World) => {
    const { output, buffers } = chunk.export({ needVoxels: true });
    const registryObj = world.registry.export();

    await this.pool.queue(async (worker) => {
      const data = await worker.test(
        Transfer(output, buffers) as any,
        registryObj
      );
      chunk.import(data);
    });

    return chunk;
  };
}

/**
 * A chunk pipeline stage for propagating chunks with light and generating mesh.
 *
 * @extends {ChunkStage}
 */
class HeightMapStage extends ChunkStage {
  name = "HeightMap";

  private pool = Pool(() => spawn<HeightMapperType>(HeightMapWorker()));

  check = () => true;

  process = async (chunk: Chunk, world: World) => {
    const { output, buffers } = chunk.export({ needVoxels: true });
    const registryObj = world.registry.export();

    await this.pool.queue(async (worker) => {
      const data = await worker.calculate(
        Transfer(output, buffers) as any,
        registryObj
      );
      chunk.import(data);
    });

    return chunk;
  };
}

/**
 * A chunk pipeline stage for calculating the height map of all chunks.
 *
 * @extends {ChunkStage}
 */
class LightMeshStage extends ChunkStage {
  name = "LightMesh";

  private pool = Pool(() => spawn<LightMesherType>(LightMeshWorker()));

  check = (chunk: Chunk, world: World) => {
    const { chunkSize, maxLightLevel } = world.chunks.worldParams;
    const r = Math.ceil(maxLightLevel / chunkSize);
    const [cx, cz] = chunk.coords;

    const ownStage = world.pipeline.getStage(chunk);

    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (x === 0 && z === 0) continue;

        const name = ChunkUtils.getChunkName([cx + x, cz + z]);
        const neighbor = world.chunks.raw(name);

        if (!neighbor) {
          return false;
        }

        const stage = world.pipeline.getStage(neighbor);

        // means chunk already finished
        if (isNaN(stage)) continue;

        if (stage < ownStage) {
          return false;
        }
      }
    }

    return true;
  };

  process = async (
    chunk: Chunk,
    world: World,
    args: { propagate: boolean } = { propagate: true }
  ) => {
    const { chunkSize, maxHeight, maxLightLevel } = world.params;
    const { output: chunkOutput, buffers: chunkBuffers } = chunk.export({
      needVoxels: true,
      needLights: true,
      needHeightMap: true,
    });

    const space = new Space(
      world.chunks,
      chunk.coords,
      { needVoxels: true, needHeightMap: true, needLights: true },
      {
        maxHeight,
        chunkSize,
        margin: maxLightLevel,
      }
    );

    const { output: spaceOutput, buffers: spaceBuffers } = space.export();
    const registryObj = world.registry.export();

    await this.pool.queue(async (worker) => {
      const { chunk: doneChunk, mesh } = await worker.run(
        Transfer(chunkOutput, chunkBuffers) as any,
        Transfer(spaceOutput, spaceBuffers) as any,
        registryObj,
        world.chunks.worldParams,
        args
      );
      chunk.import(doneChunk);
      chunk.mesh = mesh;
    });

    return chunk;
  };
}

/**
 * A customizable pipeline to populate chunks with data. The pipeline is
 * separated into a list of `ChunkStage`s and has a queue of chunks to be
 * "pipelined" through the stages. The last two stage of the pipeline is
 * always going to be `HeightMapStage` and `LightMeshStage`.
 *
 * @param world - World that this pipeline exists in
 */
class Pipeline {
  /**
   * A queue of chunks with the stages they're in.
   */
  public queue: [Chunk, number, ...any][] = [];

  private stages: ChunkStage[] = [];
  private progress = new Map<string, number>();
  private processing = 0;

  constructor(public world: World) {
    this.stages.push(new HeightMapStage());
    this.stages.push(new LightMeshStage());
  }

  /**
   * Checks whether if a chunk is being generated/populated.
   *
   * @param name - Name of the chunk to check
   * @returns Whether if the chunk is in the pipeline
   */
  hasChunk = (name: string) => {
    return this.progress.has(name);
  };

  /**
   * Append a chunk to the end of the pipeline queue.
   *
   * @param chunk - Chunk instance to be processed
   * @param stage - The stage to push the chunk into
   * @returns Pipeline itself for function chaining
   */
  appendChunk = (chunk: Chunk, stage: number) => {
    if (this.progress.has(chunk.name)) {
      throw new Error("Adding a processing chunk");
    }

    this.queue.push([chunk, stage]);
    this.progress.set(chunk.name, stage);

    return this;
  };

  /**
   * Queues the chunk back into the last stage to generate a new mesh.
   *
   * @param chunk - Chunk to be remeshed
   * @returns Pipeline itself for function chaining
   */
  remeshChunk = (chunk: Chunk) => {
    if (this.progress.has(chunk.name)) {
      console.warn("Remeshing a chunk that is already going to be remeshed.");
      return;
    }

    const meshStage = this.stages.length - 1;

    this.queue.push([chunk, meshStage, { propagate: false }]);
    this.progress.set(chunk.name, meshStage);

    return this;
  };

  /**
   * Add a stage to the pipeline. Note that any stage added will be before these two stages:
   * - `HeightMapStage`: for calculating max heights
   * - `LightMeshStage`: for propagating light through and meshing chunks
   *
   * @param stage - `ChunkStage` instance to be added
   * @returns Pipeline itself for function chaining
   */
  addStage = (stage: ChunkStage) => {
    if (!stage.process) {
      throw new Error("Chunk stage does nothing!");
    }

    this.stages.splice(this.stages.length - 2, 0, stage);

    return this;
  };

  /**
   * Check which stage the chunk is in.
   *
   * @param chunk - Chunk to be checked
   * @returns Which stage the chunk is in, or undefined
   */
  getStage = (chunk: Chunk) => {
    return this.progress.get(chunk.name);
  };

  /**
   * Updater of `Pipeline`, does the following:
   * - Push `maxChunksPerTick` amount of chunks inside the queue into their corresponding stages.
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   */
  update = () => {
    if (this.queue.length === 0) return;

    const { maxChunksPerTick } = this.worldParams;

    // only continue if the processing count is less than max chunks per tick
    for (; this.processing < maxChunksPerTick; this.processing++) {
      const process = this.queue.shift();
      if (!process) break;

      const [chunk, stage, args] = process;
      this.process(chunk, stage, args).then(() => {
        this.processing = Math.max(this.processing - 1, 0);
      });
    }
  };

  /**
   * Sends a chunk into a certain stage to be processed.
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   *
   * @param chunk - Chunk to be processed
   * @param index - Index of the stage
   * @param args - Any additional arguments
   * @returns The chunk instance itself, processed
   */
  process = async (chunk: Chunk, index: number, args: any) => {
    const stage = this.stages[index];

    if (!stage.check(chunk, this.world)) {
      this.queue.push([chunk, index]);
      return;
    }

    // console.time(`processed chunk ${chunk.name} in stage ${stage.name}`);
    await stage.process(chunk, this.world, args);
    // console.timeEnd(`processed chunk ${chunk.name} in stage ${stage.name}`);

    // last stage
    if (index < this.stages.length - 1) {
      this.progress.set(chunk.name, index + 1);
      this.queue.unshift([chunk, index + 1]);
    } else {
      this.progress.delete(chunk.name);
    }

    return chunk;
  };

  get worldParams() {
    return this.world.params;
  }
}

export { ChunkStage, TestVoxelStage, Pipeline };
