import { MessageProtocol } from "@voxelize/transport/src/types";
import { Group } from "three";

import { NetIntercept } from "./network";

export class Entity<T = any> extends Group {
  public entId: string;

  constructor(id: string) {
    super();

    this.entId = id;
  }

  /**
   * Called when the entity is created.
   */
  onSpawn: (data: T) => void;

  onUpdate: (data: T) => void;
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
  public types: Map<string, new (id: string) => Entity> = new Map();

  /**
   * Set a new entity type to the entities manager.
   *
   * @param type The type of entity to register.
   * @param entity The entity class to register.
   */
  setClass = (type: string, entity: new (id: string) => Entity) => {
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
        const { id, type, metadata } = entity;

        if (!this.types.has(type)) {
          console.warn(`Entity type ${type} is not registered.`);
          return;
        }

        let object = this.map.get(id);

        if (!object) {
          const Entity = this.types.get(type.toLowerCase());
          object = new Entity(id);
          this.map.set(id, object);
          this.add(object);
          object.onSpawn?.(metadata);
        }

        object.onUpdate?.(metadata);
      });
    }
  };
}
