import { ChunkUtils } from "@voxelize/common";
import { Pool, spawn, Transfer } from "threads";

import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Registry } from "./registry";
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

abstract class ChunkStage {
  id: number;

  abstract name: string;

  constructor(
    protected pipeline: Pipeline,
    protected chunks: Chunks,
    protected registry: Registry
  ) {}

  /**
   * Gets run to see if a chunk should propagate to the next
   * stage. True, then proceed, vice versa.
   *
   * @abstract
   * @memberof ChunkStage
   */
  abstract check: (chunk: Chunk) => boolean;

  /**
   * Gets run every system tick, processes through chunk
   * queue to do whatever this stage does.
   *
   * @returns Asynchronously returns an array of chunks
   * that are ready to be pushed to the next stage.
   *
   * @abstract
   * @memberof ChunkStage
   */
  abstract process: (chunk: Chunk) => Promise<Chunk>;
}

class TestStage extends ChunkStage {
  name = "Test";

  private pool = Pool(() => spawn<TesterType>(TestWorker()));

  check = () => true;

  process = async (chunk: Chunk) => {
    const { output, buffers } = chunk.export({ needVoxels: true });
    const registryObj = this.registry.export();

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

class HeightMapStage extends ChunkStage {
  name = "HeightMap";

  private pool = Pool(() => spawn<HeightMapperType>(HeightMapWorker()));

  check = () => true;

  process = async (chunk: Chunk) => {
    const { output, buffers } = chunk.export({ needVoxels: true });
    const registryObj = this.registry.export();

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

class LightMeshStage extends ChunkStage {
  name = "LightMesh";

  private pool = Pool(() => spawn<LightMesherType>(LightMeshWorker()));

  check = (chunk: Chunk) => {
    const { chunkSize, maxLightLevel } = this.chunks.worldParams;
    const r = Math.ceil(maxLightLevel / chunkSize);
    const [cx, cz] = chunk.coords;

    const ownStage = this.pipeline.getStage(chunk);

    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (x === 0 && z === 0) continue;

        const name = ChunkUtils.getChunkName([cx + x, cz + z]);
        const neighbor = this.chunks.raw(name);

        if (!neighbor) {
          return false;
        }

        const stage = this.pipeline.getStage(neighbor);

        // means chunk already finished
        if (isNaN(stage)) continue;

        if (stage < ownStage) {
          return false;
        }
      }
    }

    return true;
  };

  process = async (chunk: Chunk) => {
    const { chunkSize, maxHeight, maxLightLevel } = this.chunks.worldParams;
    const { output: chunkOutput, buffers: chunkBuffers } = chunk.export({
      needVoxels: true,
      needLights: true,
      needHeightMap: true,
    });

    const space = new Space(
      this.chunks,
      chunk.coords,
      { needVoxels: true, needHeightMap: true, needLights: true },
      {
        maxHeight,
        chunkSize,
        margin: maxLightLevel,
      }
    );

    const { output: spaceOutput, buffers: spaceBuffers } = space.export();
    const registryObj = this.registry.export();

    await this.pool.queue(async (worker) => {
      const { chunk: doneChunk, mesh } = await worker.run(
        Transfer(chunkOutput, chunkBuffers) as any,
        Transfer(spaceOutput, spaceBuffers) as any,
        registryObj,
        this.chunks.worldParams,
        { propagate: true }
      );
      chunk.import(doneChunk);
      chunk.mesh = mesh;
    });

    return chunk;
  };
}

const StagePresets = {
  TestStage,
  HeightMapStage,
  LightMeshStage,
};

class Pipeline {
  public queue: [Chunk, number][] = [];

  private stages: ChunkStage[] = [];
  private progress = new Map<string, number>();
  private processing = 0;

  constructor(public world: World) {
    this.addStage(TestStage);
    this.addStage(HeightMapStage);
    this.addStage(LightMeshStage);
  }

  hasChunk = (name: string) => {
    return this.progress.has(name);
  };

  addChunk = (chunk: Chunk, stage: number) => {
    if (this.progress.has(chunk.name)) {
      throw new Error("Adding a processing chunk");
    }

    this.queue.push([chunk, stage]);
    this.progress.set(chunk.name, stage);

    return this;
  };

  addStage = (
    Stage: new (p: Pipeline, c: Chunks, r: Registry) => ChunkStage
  ) => {
    const { chunks, registry } = this.world;
    const stage = new Stage(this, chunks, registry);

    if (!stage.process) {
      throw new Error("Chunk stage does nothing!");
    }

    const id = this.stages.length - 1;
    stage.id = id;

    this.stages.push(stage);

    return this;
  };

  getStage = (chunk: Chunk) => {
    return this.progress.get(chunk.name);
  };

  update = () => {
    if (this.queue.length === 0) return;

    const { maxChunksPerTick } = this.worldParams;

    // only continue if the processing count is less than max chunks per tick
    for (; this.processing < maxChunksPerTick; this.processing++) {
      const process = this.queue.shift();
      if (!process) break;

      const [chunk, stage] = process;
      this.process(chunk, stage).then(() => {
        this.processing = Math.max(this.processing - 1, 0);
      });
    }
  };

  process = async (chunk: Chunk, index: number) => {
    const stage = this.stages[index];

    if (!stage.check(chunk)) {
      this.queue.push([chunk, index]);
      return;
    }

    // console.time(`processed chunk ${chunk.name} in stage ${stage.name}`);
    await stage.process(chunk);
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

export { ChunkStage, StagePresets, Pipeline };
