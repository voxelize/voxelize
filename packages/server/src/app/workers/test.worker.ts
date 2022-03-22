import { isMainThread } from "worker_threads";

import { Transfer } from "threads";
import { expose } from "threads/worker";

import { Chunk, ChunkTransferableData } from "../chunk";
import { Registry, RegistryTransferableData } from "../registry";

const test = (
  rawChunk: ChunkTransferableData,
  registryObj: RegistryTransferableData
) => {
  const chunk = Chunk.import(rawChunk);
  const registry = Registry.import(registryObj);

  const [minX, , minZ] = chunk.min;
  const [maxX, , maxZ] = chunk.max;

  const orange = registry.getBlockByName("Orange");

  for (let x = minX; x < maxX; x++) {
    for (let z = minZ; z < maxZ; z++) {
      for (let y = 0; y < 128; y++) {
        chunk.setVoxel(x, y, z, orange.id);
      }
    }
  }

  const { output, buffers } = chunk.export({ voxels: true });

  return Transfer(output, buffers);
};

const tester = {
  test,
};

if (!isMainThread) {
  expose(tester);
}

export type TesterType = typeof tester;

export default "";
