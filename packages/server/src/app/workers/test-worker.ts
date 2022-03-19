import { parentPort } from "worker_threads";

import ndarray from "ndarray";

import { Registry } from "../registry";

parentPort.addListener("message", (data) => {
  const {
    voxels: { buffer, shape, min, max, name },
    registryObj,
  } = data;

  const voxels = ndarray<Uint32Array>(new Uint32Array(buffer), shape);

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

  parentPort.postMessage({ buffer }, [buffer]);
});
