import { WorkerPool } from "../libs";

import { ChunkEntity } from "./ents";

class ChunkStage {
  public pool: WorkerPool;
  public chunks: Set<ChunkEntity> = new Set();

  process: () => void;
}

class Pipeline {
  addStage = (stage: ChunkStage) => {
    if (!stage.process) {
      throw new Error("Chunk stage does nothing!");
    }
  };
}

export { ChunkStage, Pipeline };
