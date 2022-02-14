import { v4 as uuidv4 } from "uuid";

import { Entity } from "./entity";
import { World } from "./world";

type NewEntity = new () => Entity;

class Entities extends Map<string, Entity> {
  knownTypes: Map<string, NewEntity> = new Map();

  private packets: any[] = [];

  constructor(public world: World) {
    super();
  }

  registerEntity = (type: string, protocol: NewEntity) => {
    this.knownTypes.set(type.toLowerCase(), protocol);
  };

  addEntity = (type: string) => {
    const Protocol = this.knownTypes.get(type.toLowerCase());

    if (!Protocol) {
      console.error(`Tried to add non-existent entity: ${type}`);
      return null;
    }

    const id = uuidv4();
    const entity = new Protocol();

    entity.type = type;
    entity.id = id;

    if (entity.onCreation) {
      entity.onCreation();
    }

    this.set(id, entity);

    return entity;
  };

  addPacket = (event: any) => {
    this.packets.push(event);
  };

  tick = () => {
    if (this.size === 0) return;

    this.forEach((entity) => {
      entity.tick(this);
    });

    if (this.packets.length > 0) {
      this.world.room.broadcast({
        type: "ENTITY",
        entities: this.packets.splice(0, this.packets.length),
      });
    }
  };
}

export { Entities, NewEntity };
