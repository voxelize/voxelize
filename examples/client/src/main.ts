import { Network } from "@voxelize/network";
import { Decoder, encodePacketSync } from "@voxelize/protocol";
import "./style.css";

const network = new Network();
const decoder = new Decoder();

async function start() {
  await network.connect();
  console.log("connected!");

  const message = encodePacketSync({
    type: "INIT",
    json: {
      width: 16,
    },
  });

  console.log(message);

  decoder.onMessage = (message) => {
    console.log(message);
  };

  decoder.decode([message]);
}

start();
