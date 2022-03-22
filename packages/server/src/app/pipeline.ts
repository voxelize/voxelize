import { timeThis } from "@voxelize/common";
import { Pool, spawn, Transfer } from "threads";

import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Registry } from "./registry";
import { Space } from "./space";
import {
  LightWorker,
  LighterType,
  TesterType,
  MesherType,
  TestWorker,
  HeightMapperType,
  HeightMapWorker,
  MeshWorker,
} from "./workers";
import { World } from "./world";

abstract class ChunkStage {
  id: number;

  constructor(protected chunks: Chunks, protected registry: Registry) {}

  /**
   * Gets run to see if a chunk should propagate to the next
   * stage. True, then proceed, vice versa.
   *
   * @abstract
   * @memberof ChunkStage
   */
  abstract check: (chunk?: Chunk) => boolean;

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
  private pool = Pool(() => spawn<TesterType>(TestWorker()));

  check = () => true;

  process = async (chunk: Chunk) => {
    const { output, buffers } = chunk.export({ voxels: true });
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
  private pool = Pool(() => spawn<HeightMapperType>(HeightMapWorker()), {
    concurrency: 2,
  });

  check = () => true;

  process = async (chunk: Chunk) => {
    const { output, buffers } = chunk.export({ voxels: true });
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

class LightStage extends ChunkStage {
  private pool = Pool(() => spawn<LighterType>(LightWorker()), {
    concurrency: 4,
  });

  check = (chunk: Chunk) => {
    const neighbors = this.chunks.neighbors(...chunk.coords);
    return !(neighbors.length - Chunks.SUPPOSED_NEIGHBORS);
  };

  process = async (chunk: Chunk) => {
    const { chunkSize, maxHeight, maxLightLevel } = this.chunks.params;
    const space = new Space(chunk.coords, this.chunks, {
      maxHeight,
      chunkSize,
      margin: maxLightLevel,
    });

    const { output, buffers } = space.export();

    const registryObj = this.registry.export();

    await this.pool.queue(async (worker) => {
      const newBuffer = await worker.propagate(
        Transfer(output, buffers) as any,
        registryObj,
        this.chunks.params
      );
      chunk.lights.data = new Uint32Array(newBuffer);
    });

    return chunk;
  };
}

class MeshStage extends ChunkStage {
  private pool = Pool(() => spawn<MesherType>(MeshWorker()), {
    concurrency: 4,
  });

  check = () => true;

  process = async (chunk: Chunk) => {
    const { output, buffers } = chunk.export({ voxels: true, lights: true });
    const registryObj = this.registry.export();

    await this.pool.queue(async (worker) => {
      const data = await worker.mesh(
        Transfer(output, buffers) as any,
        registryObj
      );
      chunk.mesh = data;
    });

    return chunk;
  };
}

const StagePresets = {
  TestStage,
  HeightMapStage,
  LightStage,
  MeshStage,
};

class Pipeline {
  private stages: ChunkStage[] = [];
  private queue: [Chunk, number][] = [];

  private coords = new Set<string>();

  private processing = 0;

  constructor(public world: World) {
    this.addStage(TestStage);
    this.addStage(HeightMapStage);
    this.addStage(LightStage);
    this.addStage(MeshStage);
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

    const processes = [];

    // only continue if the processing count is less than max chunks per tick
    for (; this.processing < maxChunksPerTick; this.processing++) {
      const process = this.queue.shift();
      if (!process) break;

      const [chunk, stage] = process;
      processes.push(this.process(chunk, stage));
    }

    Promise.all(processes).then(() => {
      this.processing = 0;
    });
  };

  process = async (chunk: Chunk, index: number) => {
    const stage = this.stages[Math.floor(index)];

    if (!stage.check(chunk)) {
      this.queue.push([chunk, index]);
      return;
    }

    await stage.process(chunk);

    // last stage
    if (index < this.stages.length - 1) {
      this.queue.push([chunk, index + 1]);
    } else {
      this.coords.delete(chunk.name);
    }

    return chunk;
  };

  get params() {
    return this.world.params;
  }
}

export { ChunkStage, StagePresets, Pipeline };
