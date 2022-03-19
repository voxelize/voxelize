import { parentPort } from "worker_threads";

import { Space } from "../space";

parentPort.addListener("message", (data) => {
  const { output } = data;
  const space = Space.import(output);

  parentPort.postMessage(space.getVoxel(1, 1, 1));
});
