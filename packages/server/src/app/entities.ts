import { Entity, TypeComponent } from "@voxelize/common";

import { BaseEntity } from "./ents";
import { Constructor } from "./shared";
import { World } from "./world";

/**
 * A manager/map of all entities in the world.
 *
 * @param world - World that the chunks manager exist in
 * @extends {Map<string, Entity>}
 */
class Entities extends Map<string, Entity> {
  knownTypes: Map<string, Constructor<BaseEntity>> = new Map();

  private packets: any[] = [];

  constructor(public world: World) {
    super();
  }

  /**
   * Register a specific type of entity with a name, needs to extend ECS entity.
   *
   * @param type - Name of the type of the entity
   * @param protocol - Base class of the entity
   */
  registerEntity = <T extends BaseEntity>(
    type: string,
    protocol: Constructor<T>
  ) => {
    this.knownTypes.set(type.toLowerCase(), protocol);
  };

  /**
   * Instantiate an entity of a certain type in the world.
   *
   * @param type - Name of the type of the entity
   * @returns An entity instance of the specified type
   */
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

  /**
   * Add a packet to be broadcasted to all clients
   *
   * @param event - Anything compatible with the protocol buffers
   */
  addPacket = (event: any) => {
    this.packets.push(event);
  };

  /**
   * Handler for disconnection on `Entities`
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   */
  onDisconnect = () => {
    // TODO
  };

  /**
   * Updater for `Entities`, does the following:
   * - Broadcast all entity packets to each client in the world.
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   */
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
