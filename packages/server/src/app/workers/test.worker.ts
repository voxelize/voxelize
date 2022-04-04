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

  const marble = registry.getBlockByName("Marble");

  for (let x = minX; x < maxX; x++) {
    for (let z = minZ; z < maxZ; z++) {
      const limit = (x * z) % 7 === 0 ? 10 : 5;
      for (let y = 0; y < limit; y++) {
        chunk.setVoxel(x, y, z, marble.id);
      }
    }
  }

  const { output, buffers } = chunk.export({ needVoxels: true });

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
