const timeouts = new Map();

onmessage = (e) => {
  const { timeout, signal, id } = e.data;

  if (signal === "start") {
    const timeoutId = setTimeout(() => {
      postMessage({ signal: "timeout", id });
      timeouts.delete(id);
    }, timeout);
    timeouts.set(id, timeoutId);
  } else if (signal === "stop") {
    clearTimeout(timeouts.get(id));
    timeouts.delete(id);
  }
};
