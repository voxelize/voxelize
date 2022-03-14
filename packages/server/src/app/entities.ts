import { Vector3 } from "@math.gl/core";
import { Component, Entity } from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";

import {
  DirtyComponent,
  HeadingComponent,
  MetadataComponent,
  PositionComponent,
  TargetComponent,
  TypeComponent,
  IDComponent,
} from "./comps";
import { Constructor } from "./shared";
import { World } from "./world";

const EntityComponent = Component.register();

class BaseEntity extends Entity {
  public id: string;

  constructor() {
    super();

    this.id = uuidv4();

    this.add(new IDComponent(this.id));
    this.add(new EntityComponent());
    this.add(new PositionComponent(new Vector3()));
    this.add(new HeadingComponent(new Vector3()));
    this.add(new TargetComponent(new Vector3()));
    this.add(new MetadataComponent({}));
    this.add(new DirtyComponent(true));
  }
}

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
    if (this.size === 0) return;

    if (this.packets.length > 0) {
      this.world.room.broadcast({
        type: "ENTITY",
        entities: this.packets.splice(0, this.packets.length),
      });
    }
  };
}

export { BaseEntity, EntityComponent, Entities };
