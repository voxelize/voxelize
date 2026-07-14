import { MessageProtocol } from "@voxelize/protocol";
import { Group, Vector3 } from "three";

import { EntityLivenessTracker } from "./entity-liveness";
import { NetIntercept } from "./network";
import { isPerfLogging, logPerf } from "./perf";

export type EntityRigidBodyMetadata = {
  isInFluid: boolean;
  fluidRatio: number;
};

export type EntityMetadata = {
  rigidBody?: EntityRigidBodyMetadata;
};

export class Entity<T = any> extends Group {
  public entId: string;

  public entType = "";

  public metadata: T | null = null;

  constructor(id: string) {
    super();

    this.entId = id;
  }

  onCreate: (data: T) => void;

  onUpdate: (data: T) => void;

  onDelete: (data: T) => void;

  update?: () => void;

  setHidden?: (hidden: boolean) => void;

  snapToTarget?: () => void;
}

export type EntitiesOptions = {
  /**
   * Seconds an entity may go without any server message before it is
   * considered lost and released. Covers dropped out-of-range and delete
   * notifications so no entity can stay frozen forever.
   */
  stalenessTimeoutSeconds: number;

  /**
   * Seconds of total message silence after which staleness releases are
   * suspended, so reconnects and tab suspensions do not purge live entities.
   */
  streamSilenceGraceSeconds: number;
};

const defaultOptions: EntitiesOptions = {
  stalenessTimeoutSeconds: 10,
  streamSilenceGraceSeconds: 3,
};

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

  public options: EntitiesOptions;

  private liveness: EntityLivenessTracker;

  private unregisteredTypes = new Set<string>();

  constructor(options: Partial<EntitiesOptions> = {}) {
    super();

    this.options = { ...defaultOptions, ...options };
    this.liveness = new EntityLivenessTracker(this.options);
  }

  setClass = (
    type: string,
    entity: (new (id: string) => Entity) | ((id: string) => Entity),
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
    const nowSeconds = performance.now() / 1000;
    this.liveness.touchStream(nowSeconds);

    // An INIT marks a fresh server session (first join or a rejoin after the
    // connection dropped). Whatever we tracked belongs to the previous
    // session: release it all and let the new session's interest set stream
    // fresh snapshots, so no stale ghost can outlive a reconnect.
    if (message.type === "INIT") {
      this.releaseAllEntities();
    }

    const { entities } = message;

    if (entities && entities.length) {
      const isLogging = isPerfLogging();
      const applyStartMs = isLogging ? performance.now() : 0;
      try {
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
                // The server streams a fresh snapshot for an entity it believes
                // is new to us, so resync our stale copy to it.
                object.metadata = metadata;
                object.onUpdate?.(metadata);
                object.snapToTarget?.();
                this.liveness.touchEntity(id, nowSeconds);
                return;
              }

              object = this.createEntityOfType(type, id);
              if (object) {
                object.metadata = metadata;
                object.onCreate?.(metadata);
                this.liveness.touchEntity(id, nowSeconds);
              }

              break;
            }
            case "UPDATE": {
              // A metadata-less update is a keep-alive: the entity is unchanged
              // but still streaming.
              if (!metadata) {
                if (object) {
                  this.liveness.touchEntity(id, nowSeconds);
                }
                return;
              }

              if (!object) {
                object = this.createEntityOfType(type, id);
                if (object) {
                  object.metadata = metadata;
                  object.onCreate?.(metadata);
                }
              }

              if (object) {
                object.metadata = metadata;
                object.onUpdate?.(metadata);
                this.liveness.touchEntity(id, nowSeconds);
              }

              break;
            }
            case "DELETE":
            case "OUT_OF_RANGE": {
              if (!object) {
                return;
              }

              this.releaseEntity(object, metadata ?? object.metadata);

              break;
            }
          }
        });
      } catch (error) {
        if (isLogging) {
          logPerf("entity_apply_error", {
            traceId: message.perfTraceId ?? "",
            itemCount: entities.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      if (isLogging) {
        logPerf("entity_apply", {
          traceId: message.perfTraceId ?? "",
          itemCount: entities.length,
          byteSize: message.perfByteSize ?? 0,
          durationMs: performance.now() - applyStartMs,
        });
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
    const nowSeconds = performance.now() / 1000;
    for (const id of this.liveness.collectStale(nowSeconds)) {
      const object = this.map.get(id);
      if (object) {
        this.releaseEntity(object, object.metadata);
      } else {
        this.liveness.forget(id);
      }
    }

    const renderDistSq =
      cameraPos && renderDistance ? renderDistance * renderDistance : 0;

    this.map.forEach((entity) => {
      if (renderDistSq > 0 && cameraPos && entity.setHidden) {
        const isTooFar =
          entity.position.distanceToSquared(cameraPos) > renderDistSq;
        entity.setHidden(isTooFar);
        if (isTooFar) {
          // Keep tracking the server position while invisible so the entity
          // reappears exactly where the server says it is.
          entity.snapToTarget?.();
          return;
        }
      }

      entity.update?.();
    });
  };

  snapAllToTarget = () => {
    this.map.forEach((entity) => {
      entity.snapToTarget?.();
    });
  };

  private releaseEntity = (object: Entity, metadata: Entity["metadata"]) => {
    this.map.delete(object.entId);
    this.liveness.forget(object.entId);

    object.parent?.remove(object);
    object.onDelete?.(metadata);
  };

  private releaseAllEntities = () => {
    for (const object of [...this.map.values()]) {
      this.releaseEntity(object, object.metadata);
    }
  };

  private createEntityOfType = (type: string, id: string) => {
    if (!this.types.has(type)) {
      // Streaming entities re-send continuously; one warning per unregistered
      // type is diagnostic enough without flooding the console.
      if (!this.unregisteredTypes.has(type)) {
        this.unregisteredTypes.add(type);
        console.warn(`Entity type ${type} is not registered.`);
      }
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
    if (object) {
      object.entType = type;
    }
    this.map.set(id, object);
    this.add(object);

    return object;
  };
}
