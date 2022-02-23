import { WorkerPool } from "../libs";

import { NewEntity, Entities } from "./entities";
import { Room } from "./room";
import TestWorker from "./workers/test-worker?worker";

class World {
  public entities: Entities;

  constructor(public room: Room) {
    this.entities = new Entities(this);

    const pool = new WorkerPool(TestWorker);
    pool.addJob({
      message: "test",
      resolve(d) {
        console.log(d);
      },
    });
  }

  registerEntity = (type: string, protocol: NewEntity) => {
    return this.entities.registerEntity(type, protocol);
  };

  addEntity = (type: string) => {
    return this.entities.addEntity(type);
  };

  tick = () => {
    this.entities.tick();
  };
}

export { World };
