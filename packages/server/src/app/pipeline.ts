import { Component, DirtyFlag } from "@voxelize/common";

import { Chunks } from "./chunks";
import { Chunk } from "./ents";
import { Registry } from "./registry";
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
  process = async (chunk: Chunk) => {
    const { voxels, minInner, maxInner } = chunk;
    const [minX, , minZ] = minInner;
    const [maxX, , maxZ] = maxInner;

    const orange = this.registry.getBlockByName("Orange");

    for (let x = minX; x < maxX; x++) {
      for (let z = minZ; z < maxZ; z++) {
        for (let y = 0; y < 3; y++) {
          voxels.set(x, y, z, orange.id);
        }
      }
    }

    return chunk;
  };
}

class LightStage extends ChunkStage {
  process = async (chunk: Chunk) => {
    return chunk;
  };
}

const StagePresets = {
  TestStage,
  LightStage,
};

class Pipeline {
  /**
   * A map that keeps track of what stage each "dirty"
   * chunk is at.
   *
   * @private
   * @memberof Pipeline
   */
  private chunkStages = new Map<string, number>();

  private flags = new Map<string, Component<any>>();
  private stages: ChunkStage[] = [];

  constructor(public world: World) {
    this.addStage(TestStage);
  }

  hasChunk = (name: string) => {
    // ? why check both
    return !!this.flags.has(name) && !!this.chunkStages.has(name);
  };

  addChunk = (chunk: Chunk, stage: number) => {
    const flag = new DirtyFlag();

    chunk.add(flag);

    this.flags.set(chunk.name, flag);
    this.chunkStages.set(chunk.name, stage);

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

  process = async (chunk: Chunk) => {
    const stageId = this.chunkStages.get(chunk.name);
    if (isNaN(stageId)) {
      throw new Error(`Chunk ${chunk.name} doesn't have a stage.`);
    }

    const stage = this.stages[stageId];
    if (!stage) {
      throw new Error(`Chunk ${chunk.name} is in an unknown stage!`);
    }

    await stage.process(chunk);

    const nextStage = stageId + 1;

    // means chunk is at the end of the pipeline
    if (nextStage >= this.stages.length) {
      const flag = this.flags.get(chunk.name);
      chunk.remove(flag);

      // chunk is ready to be added back to chunks
      this.world.chunks.addChunk(chunk);

      // cleanup
      this.flags.delete(chunk.name);
      this.chunkStages.delete(chunk.name);

      return;
    }

    // otherwise increment chunk's stage
    this.chunkStages.set(chunk.name, nextStage);

    return chunk;
  };
}

export { ChunkStage, StagePresets, Pipeline };
