import { MessageProtocol } from "@voxelize/protocol";
import { Group } from "three";

import { NetIntercept } from "./network";

export class Entity<T = any> extends Group {
  public entId: string;

  constructor(id: string) {
    super();

    this.entId = id;
  }

  onCreate: (data: T) => void;

  onUpdate: (data: T) => void;

  onDelete: (data: T) => void;

  update?: () => void;
}

/**
 * A network interceptor that can be used to handle `ENTITY` messages. This is useful
 * for creating custom entities that can be sent over the network.
 *
 * TODO-DOCS
 *
 * # Example
 * ```ts
 * const entities = new VOXELIZE.Entities();
 *
 * // Define an entity type.
 * class MyEntity extends VOXELIZE.Entity<{ position: VOXELIZE.Coords3 }> {
 *   onUpdate = (data) => {
 *     // Do something with `data.position`.
 *   };
 * }
 *
 * // Register the entity type.
 * entities.setClass("my-entity", MyEntity);
 *
 * // Register the interceptor with the network.
 * network.register(entities);
 * ```
 *
 * @noInheritDoc
 * @category Core
 */
export class Entities extends Group implements NetIntercept {
  public map: Map<string, Entity> = new Map();
  public types: Map<
    string,
    (new (id: string) => Entity) | ((id: string) => Entity)
  > = new Map();

  setClass = (
    type: string,
    entity: (new (id: string) => Entity) | ((id: string) => Entity)
  ) => {
    this.types.set(type.toLowerCase(), entity);
  };

  /**
   * The network intercept implementation for entities.
   *
   * DO NOT CALL THIS METHOD OR CHANGE IT UNLESS YOU KNOW WHAT YOU ARE DOING.
   *
   * @hidden
   * @param message The message to intercept.
   */
  onMessage = (message: MessageProtocol) => {
    const { entities } = message;

    if (entities && entities.length) {
      entities.forEach((entity) => {
        const { id, type, metadata, operation } = entity;

        // ignore all block entities as they are handled by world
        if (type.startsWith("block::")) {
          return;
        }

        let object = this.map.get(id);

        switch (operation) {
          case "CREATE": {
            if (object) {
              return;
            }

            object = this.createEntityOfType(type, id);
            object.onCreate?.(metadata);

            break;
          }
          case "UPDATE": {
            if (!object) {
              object = this.createEntityOfType(type, id);
              object.onCreate?.(metadata);
            }

            object.onUpdate?.(metadata);

            break;
          }
          case "DELETE": {
            if (!object) {
              console.warn(`Entity ${id} does not exist.`);
              return;
            }

            this.map.delete(id);

            object.parent?.remove(object);
            object.onDelete?.(metadata);

            break;
          }
        }
      });
    }
  };

  /**
   * Get an entity instance by its ID.
   *
   * @param id The ID of the entity to get.
   * @returns The entity object with the given ID.
   */
  getEntityById = (id: string) => this.map.get(id);

  update = () => {
    this.map.forEach((entity) => {
      entity.update?.();
    });
  };

  private createEntityOfType = (type: string, id: string) => {
    if (!this.types.has(type)) {
      console.warn(`Entity type ${type} is not registered.`);
      return;
    }

    const Entity = this.types.get(type.toLowerCase());
    let object;
    if (
      typeof Entity === "function" &&
      Entity.prototype &&
      Entity.prototype.constructor
    ) {
      object = new (Entity as new (id: string) => Entity)(id);
    } else {
      object = (Entity as (id: string) => Entity)(id);
    }
    this.map.set(id, object);
    this.add(object);

    return object;
  };
}
