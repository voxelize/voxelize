import { WorkerPool } from "../libs";

import { World } from "./world";

class ChunkStage {
  public pool: WorkerPool;

  process: () => void;
}

class Pipeline {
  constructor(public world: World) {}

  addStage = (stage: ChunkStage) => {
    if (!stage.process) {
      throw new Error("Chunk stage does nothing!");
    }
  };
}

export { ChunkStage, Pipeline };
