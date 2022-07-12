const { Transport } = require("../dist/index.cjs");

const transport = new Transport();

transport.connect("ws://127.0.0.1:4000/", "test").then();

transport.onInit = (payload) => {
  const { entities } = payload;
  if (entities && entities.length) {
    entities.forEach((ent) => {
      if (ent.type === "box") {
        console.log(ent);
      }
    });
  }
};
