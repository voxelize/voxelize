import { Block } from "@voxelize/common";

import { NewEntity, Entities } from "./entities";
import { Registry } from "./registry";
import { Room } from "./room";

class World {
  public entities: Entities;
  public registry: Registry;

  constructor(public room: Room) {
    this.entities = new Entities(this);
    this.registry = new Registry(this);
  }

  registerEntity = (type: string, protocol: NewEntity) => {
    return this.entities.registerEntity(type, protocol);
  };

  registerBlock = (name: string, block: Partial<Block> = {}) => {
    return this.registry.registerBlock(name, block);
  };

  addEntity = (type: string) => {
    return this.entities.addEntity(type);
  };

  start = () => {
    this.registry.generate();
  };

  tick = () => {
    this.entities.tick();
  };
}

export { World };
