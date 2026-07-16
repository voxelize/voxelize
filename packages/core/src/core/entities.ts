import { EntityMotionProtocol, MessageProtocol } from "@voxelize/protocol";
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

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type MutableMetadata = { [key: string]: JsonValue };

/**
 * Fold a decoded compact motion payload back into the metadata shape entity
 * classes have always consumed (`metadata.position`, `.direction`,
 * `.rigidBody`, `.target.position`), so game code is agnostic to which wire
 * encoding the server negotiated.
 */
function applyMotionToMetadata(
  metadata: MutableMetadata,
  motion: EntityMotionProtocol,
) {
  metadata.position = motion.position;
  if (motion.direction) {
    metadata.direction = motion.direction;
  }
  if (motion.rigidBody) {
    metadata.rigidBody = motion.rigidBody;
  }
  const target = metadata.target;
  if (target && typeof target === "object" && !Array.isArray(target)) {
    // Mirrors the legacy JSON shape: a tracked target's position goes null
    // when the server loses it, it does not freeze at the last value.
    metadata.target = {
      ...target,
      position: motion.targetPosition ?? null,
    };
  } else if (motion.targetPosition) {
    metadata.target = { position: motion.targetPosition };
  }
}

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

  /**
   * Per-entity server tick of the last applied state, so out-of-order frames
   * on unordered transports (WebRTC) can never rewind an entity.
   */
  private lastAppliedTick: Map<string, number> = new Map();

  /**
   * Wall-clock ms of the last motion-bearing apply per entity, plus the gap
   * samples of the current reporting window (perf logging only).
   */
  private lastMotionApplyMs: Map<string, number> = new Map();

  private motionGapSamples: number[] = [];

  private motionGapWindowStartMs = 0;

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
    const messageTick = typeof message.tick === "number" ? message.tick : 0;

    if (entities && entities.length) {
      const isLogging = isPerfLogging();
      const applyStartMs = isLogging ? performance.now() : 0;
      try {
        entities.forEach((entity) => {
          const { id, type, metadata, operation, motion } = entity;

          // ignore all block entities as they are handled by world
          if (type.startsWith("block::")) {
            return;
          }

          let object = this.map.get(id);

          // The client half of the lifecycle ledger: every lifecycle
          // operation that reaches this client is logged with the server's
          // batch trace id, so end-to-end delivery (server queue -> client
          // apply) is measurable per entity.
          if (isLogging && operation !== "UPDATE") {
            logPerf("entity_lifecycle_apply", {
              traceId: message.perfTraceId ?? "",
              operation,
              entityId: id,
              entityType: type,
            });
          }

          switch (operation) {
            case "CREATE": {
              if (this.isStaleFrame(id, messageTick)) {
                return;
              }

              if (object) {
                // The server streams a fresh snapshot for an entity it believes
                // is new to us, so resync our stale copy to it.
                object.metadata = metadata;
                object.onUpdate?.(metadata);
                object.snapToTarget?.();
                this.noteAppliedTick(id, messageTick);
                this.liveness.touchEntity(id, nowSeconds);
                return;
              }

              object = this.createEntityOfType(type, id);
              if (object) {
                object.metadata = metadata;
                object.onCreate?.(metadata);
                this.noteAppliedTick(id, messageTick);
                this.liveness.touchEntity(id, nowSeconds);
              }

              break;
            }
            case "UPDATE": {
              // A payload-less update is a keep-alive: the entity is unchanged
              // but still streaming.
              if (!metadata && !motion) {
                if (object) {
                  this.liveness.touchEntity(id, nowSeconds);
                }
                return;
              }

              // Out-of-order state (possible on unordered transports) must
              // never rewind an entity — and must never resurrect one that a
              // later lifecycle event already released.
              if (this.isStaleFrame(id, messageTick)) {
                return;
              }

              if (!object) {
                // Only a metadata-bearing update carries enough state to
                // construct an entity (a full legacy snapshot, or healing
                // against a server that predates the compact motion path). A
                // motion-only update waits for its reliable CREATE.
                if (!metadata) {
                  return;
                }
                object = this.createEntityOfType(type, id);
                if (object) {
                  object.metadata = metadata;
                  object.onCreate?.(metadata);
                }
              }

              if (object) {
                // Merge instead of replace: compact-protocol servers send
                // motion and non-motion state independently, and metadata
                // keys are never removed server-side, so the accumulated map
                // always presents the full legacy shape to game code.
                const merged: MutableMetadata = {
                  ...(object.metadata ?? {}),
                  ...(metadata ?? {}),
                };
                if (motion) {
                  applyMotionToMetadata(merged, motion);
                }
                object.metadata = merged;
                object.onUpdate?.(merged);
                this.noteAppliedTick(id, messageTick);
                this.liveness.touchEntity(id, nowSeconds);
                if (
                  isLogging &&
                  (motion || (metadata && metadata.position !== undefined))
                ) {
                  this.recordMotionApplyGap(id);
                }
              }

              break;
            }
            case "DELETE":
            case "OUT_OF_RANGE": {
              this.noteAppliedTick(id, messageTick);

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
    this.lastMotionApplyMs.delete(object.entId);
    // lastAppliedTick is intentionally kept: it is what blocks an
    // out-of-order state frame from resurrecting the released entity. It is
    // cleared wholesale on INIT (a fresh server session).

    object.parent?.remove(object);
    object.onDelete?.(metadata);
  };

  private releaseAllEntities = () => {
    for (const object of [...this.map.values()]) {
      this.releaseEntity(object, object.metadata);
    }
    this.lastAppliedTick.clear();
  };

  private isStaleFrame = (id: string, messageTick: number) => {
    if (messageTick <= 0) {
      return false;
    }
    const lastTick = this.lastAppliedTick.get(id);
    return lastTick !== undefined && messageTick <= lastTick;
  };

  private noteAppliedTick = (id: string, messageTick: number) => {
    if (messageTick > 0) {
      this.lastAppliedTick.set(id, messageTick);
    }
  };

  private recordMotionApplyGap = (id: string) => {
    const nowMs = performance.now();
    const previousMs = this.lastMotionApplyMs.get(id);
    this.lastMotionApplyMs.set(id, nowMs);
    if (previousMs !== undefined) {
      this.motionGapSamples.push(nowMs - previousMs);
    }

    if (this.motionGapWindowStartMs === 0) {
      this.motionGapWindowStartMs = nowMs;
      return;
    }
    if (
      nowMs - this.motionGapWindowStartMs < 5000 ||
      this.motionGapSamples.length === 0
    ) {
      return;
    }

    const sorted = [...this.motionGapSamples].sort((a, b) => a - b);
    const quantile = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    logPerf("entity_motion_apply_gap", {
      count: sorted.length,
      p50Ms: quantile(0.5),
      p95Ms: quantile(0.95),
      p99Ms: quantile(0.99),
      maxMs: sorted[sorted.length - 1],
    });
    this.motionGapSamples = [];
    this.motionGapWindowStartMs = nowMs;
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
