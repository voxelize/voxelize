import MeshWorker from "web-worker:./workers/mesh-worker";

import { Client } from "..";
import { WorkerPool } from "../libs";

class Mesher {
  private pool: WorkerPool;

  constructor(public client: Client) {
    this.pool = new WorkerPool(MeshWorker);

    // setInterval(() => {
    //   this.pool.addJob({
    //     message: "bruh",
    //     resolve(d) {
    //       console.log(d);
    //     },
    //   });
    // }, 1000);
  }
}

export { Mesher };
