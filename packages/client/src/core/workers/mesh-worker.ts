self.addEventListener("message", async (e) => {
  self.postMessage("done");
});
