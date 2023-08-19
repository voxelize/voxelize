import { Network } from "@voxelize/network";
import "./style.css";

const network = new Network();

async function start() {
  await network.connect();
  console.log("connected!");
}

start();
