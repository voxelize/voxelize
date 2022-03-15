import { Entity, TypeComponent } from "@voxelize/common";

import { BaseEntity } from "./ents";
import { Constructor } from "./shared";
import { World } from "./world";

class Entities extends Map<string, Entity> {
  knownTypes: Map<string, Constructor<BaseEntity>> = new Map();

  private packets: any[] = [];

  constructor(public world: World) {
    super();
  }

  registerEntity = <T extends BaseEntity>(
    type: string,
    protocol: Constructor<T>
  ) => {
    this.knownTypes.set(type.toLowerCase(), protocol);
  };

  addEntity = (type: string) => {
    const Protocol = this.knownTypes.get(type.toLowerCase());

    if (!Protocol) {
      console.error(`Tried to add non-existent entity: ${type}`);
      return null;
    }

    const entity = new Protocol();

    entity.add(new TypeComponent(type));
    this.set(entity.id, entity);

    return entity;
  };

  addPacket = (event: any) => {
    this.packets.push(event);
  };

  update = () => {
    if (this.size === 0 || this.packets.length === 0) return;

    const entities = this.packets.splice(0, this.packets.length);
    this.world.room.broadcast({
      type: "ENTITY",
      entities,
    });
  };
}

export { BaseEntity, Entities };
