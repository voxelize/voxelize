import { Chunks } from "./chunks";
import { Chunk } from "./ents";
import { World } from "./world";

abstract class ChunkStage {
  queue: Chunk[] = [];
  isLast = true;

  constructor(protected chunks: Chunks) {}

  /**
   * Gets run every system tick, processes through chunk
   * queue to do whatever this stage does.
   *
   * @returns Asynchronously returns an array of chunks
   * that are ready to be pushed to the next stage.
   *
   * @memberof ChunkStage
   */
  abstract process: () => Promise<Chunk[]>;
}

class TestStage extends ChunkStage {
  process = async () => {
    const list: Chunk[] = [];

    return list;
  };
}

class LightStage extends ChunkStage {
  process = async () => {
    const list: Chunk[] = [];

    return list;
  };
}

const ChunkStages = {
  TestStage,
  LightStage,
};

class Pipeline {
  private stages: ChunkStage[] = [];

  constructor(public world: World) {}

  addStage = (stage: ChunkStage) => {
    if (!stage.process) {
      throw new Error("Chunk stage does nothing!");
    }

    this.stages[this.stages.length - 1].isLast = false;
    this.stages.push(stage);

    return this;
  };
}

export { ChunkStage, ChunkStages, Pipeline };
