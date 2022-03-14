import { ChunkUtils, Coords3, Entity, System } from "@voxelize/common";

import { CurrentChunkComponent, PositionComponent } from "../comps";

class CurrentChunkSystem extends System {
  constructor(private chunkSize: number) {
    super([PositionComponent.type, CurrentChunkComponent.type]);
  }

  update(entity: Entity) {
    const position = PositionComponent.get(entity).data;
    const currChunk = CurrentChunkComponent.get(entity).data;

    const [cx, cz] = ChunkUtils.mapVoxelPosToChunkPos(
      position.toArray() as Coords3,
      this.chunkSize
    );

    currChunk.set(cx, cz);
  }
}

export { CurrentChunkSystem };
