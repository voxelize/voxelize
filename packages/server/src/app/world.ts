import { NewEntity, Entities } from "./entities";
import { Room } from "./room";

class World {
  public entities: Entities;

  constructor(public room: Room) {
    this.entities = new Entities(this);
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
