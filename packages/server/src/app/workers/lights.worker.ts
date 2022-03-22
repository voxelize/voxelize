import { isMainThread } from "worker_threads";

import { Transfer } from "threads";
import { expose } from "threads/worker";

import { Lights } from "../lights";
import { Registry, RegistryTransferableData } from "../registry";
import { Space, SpaceTransferableData } from "../space";
import { WorldParams } from "../world";

const propagate = (
  spaceObj: SpaceTransferableData,
  registryObj: RegistryTransferableData,
  params: WorldParams
) => {
  const space = Space.import(spaceObj);
  const registry = Registry.import(registryObj);

  const chunkData = Lights.propagate(space, registry, params);

  return Transfer(chunkData.data.buffer, [chunkData.data.buffer]);
};

const lighter = {
  propagate,
};

if (!isMainThread) {
  expose(lighter);
}

export type LighterType = typeof lighter;

export default "";
