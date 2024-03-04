import IntervalWorker from "web-worker:./workers/interval-worker";

export function setWorkerInterval(func: () => void, interval: number) {
  const worker = new IntervalWorker();

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
