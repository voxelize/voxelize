import { NetIntercept, Network } from "@voxelize/network";
import { Message } from "@voxelize/protocol";
import "./style.css";

const packetTest = document.getElementById("packet-test") as HTMLButtonElement;
packetTest.addEventListener("click", () => {
  network.sendPackets([
    {
      type: "INIT",
      json: { name: "test" },
      chunks: [
        {
          x: 0,
          z: 0,
          id: "test",
          blocks: new Uint32Array(16 * 16 * 16).fill(
            0x000000ff | (0x0000ff00 << 8) | (0x00ff0000 << 16),
          ),
          lights: new Uint32Array(16 * 16 * 16),
          meshes: [],
          metainfo: {},
        },
      ],
    },
  ]);
});

class Test implements NetIntercept {
  onMessages(messages: Message[]) {
    console.log(messages);
  }
}

const test = new Test();

const network = new Network();

network.register(test);

async function start() {
  await network.connect();
  console.log("connected!");
}

start();
