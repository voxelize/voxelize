import { Pool, spawn } from "threads";

import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Registry } from "./registry";
import { Test2Worker } from "./workers";
import { World } from "./world";

abstract class ChunkStage {
  id: number;

  constructor(protected chunks: Chunks, protected registry: Registry) {}

  /**
   * Gets run every system tick, processes through chunk
   * queue to do whatever this stage does.
   *
   * @returns Asynchronously returns an array of chunks
   * that are ready to be pushed to the next stage.
   *
   * @memberof ChunkStage
   */
  abstract process: (chunk: Chunk) => Promise<Chunk>;
}

class TestStage extends ChunkStage {
  private pool = Pool(() => spawn(Test2Worker, { timeout: 30000 }), {
    concurrency: 2,
    size: 16,
  });

  process = async (chunk: Chunk) => {
    // const { voxels, min, max } = chunk;
    // const {
    //   data: { buffer },
    //   shape,
    // } = voxels;
    //Imports

    const result = await new Promise<number>((resolve) => {
      this.pool.queue(async (worker) => {
        console.log(await worker("Hello world!"));
        resolve(1);
      });
    });

    console.log(result);

    // //Create a blob worker
    // const worker = await spawn(BlobWorker.fromText(WorkerText));

    // //Echo some text
    // console.log(await worker("Hello World!")); //Worker received: Hello World!

    // //Destroy the worker
    // await Thread.terminate(worker);

    // const registryObj = this.registry.export();

    // const results = await new Promise<any>((resolve) =>
    //   this.pool.addJob({
    //     message: {
    //       voxels: { buffer, shape, min, max },
    //       registryObj,
    //     },
    //     resolve,
    //     buffers: [buffer],
    //   })
    // );

    // voxels.data = new Uint32Array(results.buffer);

    return chunk;
  };
}

class LightStage extends ChunkStage {
  // private pool = new WorkerPool(LightsWorker);

  process = async (chunk: Chunk) => {
    // const { chunkSize, maxHeight, maxLightLevel } = this.chunks.params;
    // const space = new Space(chunk.coords, this.chunks, {
    //   maxHeight,
    //   chunkSize,
    //   margin: maxLightLevel,
    // });

    // const { output, buffers } = space.export();

    return chunk;
  };
}

const StagePresets = {
  TestStage,
  LightStage,
};

class Pipeline {
  private stages: ChunkStage[] = [];
  private queue: [Chunk, number][] = [];

  private coords = new Set<string>();

  private processing = 0;

  constructor(public world: World) {
    this.addStage(TestStage);
    this.addStage(LightStage);
  }

  hasChunk = (name: string) => {
    return this.coords.has(name);
  };

  addChunk = (chunk: Chunk, stage: number) => {
    if (this.coords.has(chunk.name)) {
      throw new Error("Adding a processing chunk");
    }

    this.queue.push([chunk, stage]);
    this.coords.add(chunk.name);

    return this;
  };

  addStage = (Stage: new (c: Chunks, r: Registry) => ChunkStage) => {
    const { chunks, registry } = this.world;
    const stage = new Stage(chunks, registry);

    if (!stage.process) {
      throw new Error("Chunk stage does nothing!");
    }

    const id = this.stages.length - 1;
    stage.id = id;

    this.stages.push(stage);

    return this;
  };

  update = () => {
    if (this.queue.length === 0) return;

    const { maxChunksPerTick } = this.params;

    // only continue if the processing count is less than max chunks per tick
    for (; this.processing < maxChunksPerTick; this.processing++) {
      const [chunk, stage] = this.queue.shift();

      this.process(chunk, stage).then(() => {
        this.processing--;
      });
    }
  };

  process = async (chunk: Chunk, index: number) => {
    const stage = this.stages[index];

    await stage.process(chunk);

    // last stage
    if (index < this.stages.length - 1) {
      this.queue.push([chunk, index + 1]);
    } else {
      this.world.chunks.addChunk(chunk);
      this.coords.delete(chunk.name);
    }

    return chunk;
  };

  get params() {
    return this.world.params;
  }
}

export { ChunkStage, StagePresets, Pipeline };
