self.addEventListener("message", (e) => {
  // const message = e.data || e;

  // switch(message.type) {
  // }
  self.postMessage({ num: 3 });
});

export {};
