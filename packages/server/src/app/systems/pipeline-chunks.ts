import { ChunkFlag, DirtyFlag, Entity, System } from "@voxelize/common";

import { Chunk } from "../ents";
import { Pipeline } from "../pipeline";

class PipelineChunksSystem extends System {
  private processing = 0;

  constructor(private pipeline: Pipeline) {
    super([ChunkFlag.type, DirtyFlag.type]);
  }

  /**
   * Problem: don't know how to prioritize chunks
   *
   * @param {Chunk} chunk
   * @returns {void}
   * @memberof PipelineChunksSystem
   */
  update(chunk: Chunk): void {
    // check through pipeline to see how many stages
    if (!(chunk instanceof Chunk))
      throw new Error(
        `Pipelining unknown entity: ${(chunk as any as Entity).entId}`
      );

    // if this system is already processing too many chunks, then
    // stop ticking the system
    if (this.isBusy) {
      return;
    }

    this.processing++;
    this.pipeline.process(chunk).then(() => {
      this.processing--;
    });
  }

  private get isBusy() {
    const { maxChunksPerTick } = this.pipeline.world.params;
    return this.processing >= maxChunksPerTick;
  }
}

export { PipelineChunksSystem };
