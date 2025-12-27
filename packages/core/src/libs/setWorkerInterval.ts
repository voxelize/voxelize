import IntervalWorker from "./workers/interval-worker?worker&inline";

export function setWorkerInterval(func: () => void, interval: number) {
  const worker = new IntervalWorker({ name: "interval-worker" });

  worker.postMessage({ signal: "start", interval });

  worker.onmessage = (e) => {
    if (e.data === "tick") {
      func();
    }
  };

  return () => {
    worker.postMessage({ signal: "stop" });
    worker.terminate();
  };
}
