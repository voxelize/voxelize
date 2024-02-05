// @ts-ignore
onmessage = (e) => {
  const {
    data: { interval, signal },
  } = e;

  let id: any;

  if (signal === "start") {
    id = setInterval(() => {
      postMessage("tick");
    }, interval);
  } else if (signal === "stop") {
    clearInterval(id);
  }
};
