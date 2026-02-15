import { MessageProtocol } from "@voxelize/protocol";
import { Group, Vector3 } from "three";

import { JsonValue } from "../types";
import { toLowerCaseIfNeeded } from "../utils/string-utils";
import { NetIntercept } from "./network";

const normalizeEntityType = (type: string): string => {
  return toLowerCaseIfNeeded(type);
};

export class Entity<T = JsonValue> extends Group {
  public entId: string;

  constructor(id: string) {
    super();

    this.entId = id;
  }

  onCreate: (data: T) => void;

  onUpdate: (data: T) => void;

  onDelete: (data: T) => void;

  update?: () => void;

  setHidden?: (hidden: boolean) => void;
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
  public types: Map<string, (id: string) => Entity> = new Map();

  setClass = (
    type: string,
    entity: (new (id: string) => Entity) | ((id: string) => Entity)
  ) => {
    const isEntityClass =
      typeof entity === "function" && entity.prototype instanceof Entity;
    const factory =
      isEntityClass
        ? (id: string) => new (entity as new (id: string) => Entity)(id)
        : (entity as (id: string) => Entity);

    this.types.set(normalizeEntityType(type), factory);
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
    const entityUpdates = message.entities;
    const entityCount = entityUpdates?.length ?? 0;
    if (entityCount === 0) {
      return;
    }

    for (let entityIndex = 0; entityIndex < entityCount; entityIndex++) {
      const entity = entityUpdates[entityIndex];
      const { id, type, metadata, operation } = entity;

      // ignore all block entities as they are handled by world
      if (type.startsWith("block::")) {
        continue;
      }

      let object = this.map.get(id);

      switch (operation) {
        case "CREATE": {
          if (object) {
            continue;
          }

          const createdObject = this.createEntityOfType(type, id);
          if (!createdObject) {
            continue;
          }
          object = createdObject;
          object.onCreate?.(metadata);

          break;
        }
        case "UPDATE": {
          if (!object) {
            const createdObject = this.createEntityOfType(type, id);
            if (!createdObject) {
              continue;
            }
            object = createdObject;
            object.onCreate?.(metadata);
          }

          object.onUpdate?.(metadata);

          break;
        }
        case "DELETE": {
          if (!object) {
            console.warn(`Entity ${id} does not exist.`);
            continue;
          }

          this.map.delete(id);

          object.parent?.remove(object);
          object.onDelete?.(metadata);

          break;
        }
      }
    }
  };

  /**
   * Get an entity instance by its ID.
   *
   * @param id The ID of the entity to get.
   * @returns The entity object with the given ID.
   */
  getEntityById = (id: string) => this.map.get(id);

  update = (cameraPos?: Vector3, renderDistance?: number) => {
    const renderDistSq =
      cameraPos && renderDistance ? renderDistance * renderDistance : 0;
    const shouldCullByDistance = renderDistSq > 0 && !!cameraPos;

    let entities = this.map.values();
    let entityEntry = entities.next();
    while (!entityEntry.done) {
      const entity = entityEntry.value;
      if (shouldCullByDistance && cameraPos && entity.setHidden) {
        const tooFar = entity.position.distanceToSquared(cameraPos) > renderDistSq;
        entity.setHidden(tooFar);
        if (tooFar) {
          entityEntry = entities.next();
          continue;
        }
      }

      entity.update?.();
      entityEntry = entities.next();
    }
  };

  snapAllToTarget = () => {
    let entities = this.map.values();
    let entityEntry = entities.next();
    while (!entityEntry.done) {
      const entity = entityEntry.value;
      (entity as Entity & { snapToTarget?: () => void }).snapToTarget?.();
      entityEntry = entities.next();
    }
  };

  private createEntityOfType = (type: string, id: string) => {
    const normalizedType = normalizeEntityType(type);
    const entityFactory = this.types.get(normalizedType);
    if (!entityFactory) {
      console.warn(`Entity type ${type} is not registered.`);
      return;
    }

    const object = entityFactory(id);
    this.map.set(id, object);
    this.add(object);

    return object;
  };
}
