import { Coords3 } from "@voxelize/common";
import ndarray from "ndarray";
import { Transfer } from "threads";
import { expose } from "threads/worker";

import { Registry, RegistryTransferableData } from "../registry";

const run = (
  buffer: ArrayBuffer,
  registryObj: RegistryTransferableData,
  min: Coords3,
  max: Coords3
) => {
  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;

  const dimX = endX - startX;
  const dimY = endY - startY;
  const dimZ = endZ - startZ;

  const voxels = ndarray<Uint32Array>(new Uint32Array(buffer), [
    dimX,
    dimY,
    dimZ,
  ]);

  const registry = Registry.import(registryObj);

  const [minX, , minZ] = min;
  const [maxX, , maxZ] = max;

  const orange = registry.getBlockByName("Orange");

  for (let x = minX; x < maxX; x++) {
    for (let z = minZ; z < maxZ; z++) {
      for (let y = 0; y < 3; y++) {
        voxels.set(x - minX, y, z - minZ, orange.id);
      }
    }
  }

  return Transfer({ buffer }, [buffer]);
};

const runner = {
  run,
};

expose(runner);

export type Runner = typeof runner;

export default "";
