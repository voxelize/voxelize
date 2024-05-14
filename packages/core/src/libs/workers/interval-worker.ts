// @ts-ignore
// Improved version with type annotations and scoped interval ID management
type WorkerMessage = {
  interval?: number;
  signal: "start" | "stop";
};

let intervalId: any | null = null;

function clearExistingInterval() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null; // Reset interval ID after clearing
  }
}

onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { interval, signal } = e.data;

  if (signal === "start") {
    // Ensure no interval is running before starting a new one
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
