// @ts-ignore
// Improved version with type annotations and scoped interval ID management
type WorkerMessage = {
  interval?: number;
  signal: "start" | "stop";
};

let intervalId: ReturnType<typeof setInterval> | null = null;

function clearExistingInterval() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { interval, signal } = e.data;

  if (signal === "start") {
    clearExistingInterval();
    if (interval !== undefined) {
      intervalId = setInterval(() => {
        postMessage("tick");
      }, interval);
    }
  } else if (signal === "stop") {
    clearExistingInterval();
  }
};
