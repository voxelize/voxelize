import TimeoutWorker from "./workers/timeout-worker?worker&inline";

export function setWorkerTimeout(func: () => void, timeout: number) {
  const worker = new TimeoutWorker({ name: "timeout-worker" });
  let messageId = 0; // Unique ID for each message

  const callbackWrapper = (id: number) => {
    worker.postMessage({ signal: "start", timeout, id });
  };

  worker.onmessage = (e) => {
    if (e.data.signal === "timeout" && e.data.id === messageId) {
      // One-shot: the worker's job ends with its timeout. Without this,
      // every fired timeout leaks a live worker unless the caller invokes
      // the canceler it usually has no reason to call.
      worker.terminate();
      func();
    }
  };

  callbackWrapper(++messageId);

  return () => {
    worker.postMessage({ signal: "stop", id: messageId });
    worker.terminate();
  };
}
