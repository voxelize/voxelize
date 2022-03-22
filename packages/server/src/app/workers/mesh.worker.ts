import { isMainThread } from "worker_threads";

import { Transfer } from "threads";
import { expose } from "threads/worker";

import { Chunk, ChunkTransferableData } from "../chunk";
import { Mesher } from "../mesher";
import { Registry, RegistryTransferableData } from "../registry";

const mesh = (
  rawChunk: ChunkTransferableData,
  registryObj: RegistryTransferableData
) => {
  const chunk = Chunk.import(rawChunk);
  const registry = Registry.import(registryObj);

  const opaque = Mesher.meshChunk(chunk, registry, false);
  const transparent = Mesher.meshChunk(chunk, registry, true);

  return Transfer({ opaque: opaque.data, transparent: transparent.data }, [
    ...opaque.buffers,
    ...transparent.buffers,
  ]);
};

const mesher = {
  mesh,
};

if (!isMainThread) {
  expose(mesher);
}

export type MesherType = typeof mesher;

export default "";
