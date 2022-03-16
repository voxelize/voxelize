import { ChunkUtils, Coords3, Entity, System } from "@voxelize/common";

import { CurrentChunkComponent, Position3DComponent } from "../comps";

class CurrentChunkSystem extends System {
  constructor(private chunkSize: number) {
    super([Position3DComponent.type, CurrentChunkComponent.type]);
  }

  update(entity: Entity) {
    const position = Position3DComponent.get(entity).data;
    const currChunk = CurrentChunkComponent.get(entity).data;

    const [cx, cz] = ChunkUtils.mapVoxelPosToChunkPos(
      position.toArray() as Coords3,
      this.chunkSize
    );

    if (currChunk.chunk.x !== cx || currChunk.chunk.z !== cz) {
      currChunk.chunk.x = cx;
      currChunk.chunk.z = cz;
      currChunk.changed = true;
    }
  }
}

export { CurrentChunkSystem };
