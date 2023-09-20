import { Registry } from "../registry";

// @ts-ignore
onmessage = function (e) {
  const { registryData, chunkData } = e.data;
  const registry = Registry.deserialize(registryData);
  console.log(chunkData);

  postMessage({ registry: registry.serialize() });
};
