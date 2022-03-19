import { BlobWorker, Pool, spawn, Thread, Transfer } from "threads";

import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Registry } from "./registry";
import { Runner, TestWorker } from "./workers";
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
  private pool = Pool(() => spawn<Runner>(TestWorker()));

  process = async (chunk: Chunk) => {
    const { voxels, min, max } = chunk;
    const {
      data: { buffer },
    } = voxels;

    const registryObj = this.registry.export();

    const { buffer: newBuffer } = await new Promise((resolve) => {
      this.pool.queue(async (worker) => {
        const b = buffer.slice(0);
        resolve(await worker.run(Transfer(b, [b]), registryObj, min, max));
      });
    });

    voxels.data = new Uint32Array(newBuffer);

    return chunk;
  };
}

class LightStage extends ChunkStage {
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
