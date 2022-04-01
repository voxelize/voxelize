import { isMainThread } from "worker_threads";

import { Transfer } from "threads";
import { expose } from "threads/worker";

import { Chunk, ChunkTransferableData } from "../chunk";
import { Lights } from "../lights";
import { Mesher } from "../mesher";
import { Registry, RegistryTransferableData } from "../registry";
import { Space, SpaceTransferableData } from "../space";
import { WorldParams } from "../world";

const run = (
  rawChunk: ChunkTransferableData,
  spaceObj: SpaceTransferableData,
  registryObj: RegistryTransferableData,
  params: WorldParams,
  options: {
    propagate: boolean;
  }
) => {
  const chunk = Chunk.import(rawChunk);
  const space = Space.import(spaceObj);
  const registry = Registry.import(registryObj);

  if (options.propagate) {
    console.time(`Propagating chunk ${chunk.name}`);
    const lights = Lights.propagate(space, registry, params);
    console.timeEnd(`Propagating chunk ${chunk.name}`);
    chunk.lights.data = lights.data;
  }

  console.time(`Meshing chunk ${chunk.name}`);
  const opaque = Mesher.meshSpace(chunk.min, chunk.max, space, registry, false);
  const transparent = Mesher.meshSpace(
    chunk.min,
    chunk.max,
    space,
    registry,
    true
  );
  console.timeEnd(`Meshing chunk ${chunk.name}`);

  const { output, buffers } = chunk.export({
    needHeightMap: true,
    needLights: true,
    needVoxels: true,
  });

  return Transfer(
    {
      chunk: output,
      mesh: {
        opaque: opaque.data,
        transparent: transparent.data,
      },
    },
    [...buffers, ...opaque.buffers, ...transparent.buffers]
  );
};

const lightMesh = {
  run,
};

if (!isMainThread) {
  expose(lightMesh);
}

export type LightMesherType = typeof lightMesh;

export default "";
