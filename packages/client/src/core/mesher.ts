import { Client } from "..";
import { WorkerPool } from "../libs";

class Mesher {
  constructor(public client: Client) {
    const pool = new WorkerPool("./workers/mesh-worker.ts");

    setInterval(() => {
      pool.addJob({
        message: { test: "3" },
        resolve(data) {
          console.log(data);
        },
      });
    }, 1000);
  }
}

export { Mesher };
