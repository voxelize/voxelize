import { Transfer } from "threads";
import { expose } from "threads/worker";

import { Registry, RegistryTransferableData } from "../registry";

const run = (registryObj: RegistryTransferableData, buffer: any) => {
  const registry = Registry.import(registryObj);

  return {
    buffer: Transfer(buffer),
    registryObj,
    type: registry.getBlockById(1),
  };
};

const runner = {
  run,
};

expose(runner);

export type Runner = typeof runner;

export default "";
