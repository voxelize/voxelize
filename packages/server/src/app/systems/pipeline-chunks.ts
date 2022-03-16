import { ChunkFlag, DirtyFlag, System } from "@voxelize/common";

import { Chunks } from "../chunks";
import { StageComponent } from "../comps";
import { Chunk } from "../ents";
import { Pipeline } from "../pipeline";

class PipelineChunksSystem extends System {
  constructor(private pipeline: Pipeline, private chunks: Chunks) {
    super([StageComponent.type, ChunkFlag.type, DirtyFlag.type]);
  }

  update(chunk: Chunk): void {
    console.log(chunk.name);
  }
}

export { PipelineChunksSystem };
