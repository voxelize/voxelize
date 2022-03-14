import { Vector3 } from "@math.gl/core";
import { Entity } from "@voxelize/common";

import {
  DirtyComponent,
  HeadingComponent,
  MetadataComponent,
  PositionComponent,
  TargetComponent,
  TypeComponent,
} from "./comps";
import { Constructor } from "./shared";
import { World } from "./world";

class Entities extends Map<number, Entity> {
  knownTypes: Map<string, Constructor<Entity>> = new Map();

  private packets: any[] = [];

  constructor(public world: World) {
    super();
  }

  registerEntity = <T extends Entity>(
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

    entity.add(new PositionComponent(new Vector3()));
    entity.add(new HeadingComponent(new Vector3()));
    entity.add(new TargetComponent(new Vector3()));
    entity.add(new MetadataComponent({}));
    entity.add(new TypeComponent(type));
    entity.add(new DirtyComponent(true));

    this.set(entity.id, entity);

    return entity;
  };

  addPacket = (event: any) => {
    this.packets.push(event);
  };

  tick = () => {
    if (this.size === 0) return;

    if (this.packets.length > 0) {
      this.world.room.broadcast({
        type: "ENTITY",
        entities: this.packets.splice(0, this.packets.length),
      });
    }
  };
}

export { Entities };
