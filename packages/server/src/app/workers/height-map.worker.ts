import { isMainThread } from "worker_threads";

import { Transfer } from "threads";
import { expose } from "threads/worker";

import { Chunk, ChunkTransferableData } from "../chunk";
import { Registry, RegistryTransferableData } from "../registry";

const calculate = (
  rawChunk: ChunkTransferableData,
  registryObj: RegistryTransferableData
) => {
  const chunk = Chunk.import(rawChunk);

  const [minX, , minZ] = chunk.min;
  const [maxX, , maxZ] = chunk.max;

  const registry = Registry.import(registryObj);

  const { maxHeight } = chunk.params;

  for (let x = minX; x < maxX; x++) {
    for (let z = minZ; z < maxZ; z++) {
      for (let y = maxHeight - 1; y >= 0; y--) {
        const id = chunk.getVoxel(x, y, z);
        const { isPlant, isFluid } = registry.getBlockById(id);

        if (y === 0 || (id !== 0 && !isPlant && !isFluid)) {
          chunk.setMaxHeight(x, z, y);
          break;
        }
      }
    }
  }

  const { output, buffers } = chunk.export({ heightMap: true });

  return Transfer(output, buffers);
};

const heightMapper = {
  calculate,
};

if (!isMainThread) {
  expose(heightMapper);
}

export type HeightMapperType = typeof heightMapper;

export default "";
