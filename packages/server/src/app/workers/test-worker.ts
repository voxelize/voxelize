import { parentPort } from "worker_threads";

parentPort.addListener("message", async (data) => {
  parentPort.postMessage(data);
});
