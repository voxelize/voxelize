import { AABB } from "@voxelize/aabb";
import { Collider, Engine as PhysicsEngine } from "@voxelize/physics-engine";
import {
  EntityMotionProtocol,
  EntityOperation,
  EntityProtocol,
  MessageProtocol,
} from "@voxelize/protocol";
import {
  type Camera,
  Frustum,
  Group,
  Matrix4,
  Sphere,
  Vector3,
} from "three/webgpu";

import { SpriteText } from "../libs/sprite-text";
import { releaseObject } from "../utils/three-utils";

import { EntityLivenessTracker } from "./entity-liveness";
import { NetIntercept } from "./network";
import { isPerfLogging, logPerf } from "./perf";

export type EntityRigidBodyMetadata = {
  isInFluid: boolean;
  fluidRatio: number;
};

/**
 * Solid boxes the server gives an entity (its `CollidersComp`), relative to
 * its position: `[minX, minY, minZ, maxX, maxY, maxZ]` each.
 */
export type EntityCollidersMetadata = [
  number,
  number,
  number,
  number,
  number,
  number,
][];

export type EntityMetadata = {
  rigidBody?: EntityRigidBodyMetadata;
  colliders?: EntityCollidersMetadata;
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
 * Metadata key the server sets on entities pinned by the freeze mechanic.
 * While true, the client must hold the entity's pose: its class update
 * (animation clocks, interpolation) is skipped entirely.
 */
export const FROZEN_METADATA_KEY = "frozen";

export function isEntityMetadataFrozen(
  metadata: MutableMetadata | null | undefined,
): boolean {
  return metadata?.[FROZEN_METADATA_KEY] === true;
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether two decoded metadata values say the same thing. */
function isSameJson(
  a: JsonValue | undefined,
  b: JsonValue | undefined,
): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isSameJson(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  let shared = 0;
  for (const key in a) {
    if (!(key in b) || !isSameJson(a[key], b[key])) return false;
    shared += 1;
  }
  // Every key of `a` is in `b` and agrees; `b` must hold no others.
  let total = 0;
  for (const key in b) {
    if (key in b) total += 1;
  }
  return total === shared;
}

/**
 * Merge an incoming (possibly partial) metadata update over the accumulated
 * map. `target` straddles the two replication lanes — identity
 * (`targetType`, `id`) rides the metadata lane while its `position` rides
 * the motion lane — so it merges key-wise: a metadata-lane target that
 * carries no `position` of its own must never clobber the motion-maintained
 * one. An explicit incoming `position` (legacy full snapshots, or null)
 * still wins.
 *
 * A value that arrives saying what the held one already says keeps the held
 * one. A server resends an entity's whole metadata when one key of it
 * changes, so most of what arrives is a copy of what is here; taking the
 * copies would retire values that have lived for seconds each time, and
 * memory that old is only reclaimed by a major collection, whose pause is
 * long enough to drop a frame. Left alone, the copy is freed young, for
 * nothing. It also means a key that did not change keeps its identity.
 */
function mergeMetadataUpdate(
  previous: MutableMetadata | null | undefined,
  incoming: MutableMetadata | null | undefined,
): MutableMetadata {
  const merged: MutableMetadata = { ...(previous ?? {}) };
  if (!incoming) return merged;
  for (const key in incoming) {
    const arrived = incoming[key];
    const held = previous?.[key];
    if (key === "target" && isJsonObject(held) && isJsonObject(arrived)) {
      merged.target = mergeTarget(held, arrived);
    } else {
      merged[key] = isSameJson(held, arrived) ? (held as JsonValue) : arrived;
    }
  }
  return merged;
}

/** The held target with what arrived laid over it, or the held one itself
 * when nothing that arrived differs from it. */
function mergeTarget(
  held: { [key: string]: JsonValue },
  arrived: { [key: string]: JsonValue },
): { [key: string]: JsonValue } {
  let merged: { [key: string]: JsonValue } | null = null;
  for (const key in arrived) {
    if (key in held && isSameJson(held[key], arrived[key])) continue;
    merged ??= { ...held };
    merged[key] = arrived[key];
  }
  return merged ?? held;
}

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

function isCoords3(
  value: JsonValue | undefined,
): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/**
 * The world-space box of a replicated collider box (`[minX, minY, minZ,
 * maxX, maxY, maxZ]` relative to `position`), or `null` when it is not one
 * the physics engine takes: finite bounds, min below max on every axis.
 */
function placeColliderBox(
  box: JsonValue,
  [px, py, pz]: [number, number, number],
): AABB | null {
  if (!Array.isArray(box) || box.length !== 6) return null;
  if (!box.every((v): v is number => typeof v === "number")) return null;
  const [minX, minY, minZ, maxX, maxY, maxZ] = box;
  const aabb = new AABB(
    px + minX,
    py + minY,
    pz + minZ,
    px + maxX,
    py + maxY,
    pz + maxZ,
  );
  const hasFiniteBounds = [
    aabb.minX,
    aabb.minY,
    aabb.minZ,
    aabb.maxX,
    aabb.maxY,
    aabb.maxZ,
  ].every(Number.isFinite);
  return hasFiniteBounds &&
    aabb.minX < aabb.maxX &&
    aabb.minY < aabb.maxY &&
    aabb.minZ < aabb.maxZ
    ? aabb
    : null;
}

/** Whether two replicated `colliders` values hold the same boxes. */
function isSameColliderBoxes(a: JsonValue, b: JsonValue) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  return a.every((box, i) => {
    const other = b[i];
    return (
      Array.isArray(box) &&
      Array.isArray(other) &&
      box.length === other.length &&
      box.every((v, j) => v === other[j])
    );
  });
}

export class Entity<T = any> extends Group {
  public entId: string;

  public entType = "";

  public metadata: T | null = null;

  constructor(id: string) {
    super();

    this.entId = id;
  }

  /**
   * The scene walk's matrix update, skipped while nothing under the entity
   * draws: an instanced creature draws from its pool, and its group holds
   * only a hidden nametag. Hundreds of them were half the walk's objects,
   * rebuilt every frame for nothing. A child shown again is placed on the
   * next walk; `getWorldPosition` and `updateWorldMatrix` compute as ever.
   */
  override updateMatrixWorld(force?: boolean): void {
    if (!this.hasDrawnChild()) {
      // A parent that moved would have forced this; catch up when shown.
      if (force) this.matrixWorldNeedsUpdate = true;
      return;
    }
    super.updateMatrixWorld(force);
  }

  private hasDrawnChild(): boolean {
    const children = this.children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].visible) return true;
    }
    return false;
  }

  onCreate: (data: T) => void;

  onUpdate: (data: T) => void;

  onDelete: (data: T) => void;

  update?: () => void;

  /**
   * Called each frame in place of `update` while the server holds the
   * entity frozen. The pose holds, but state that belongs to the world
   * rather than the pose — the voxel light an instance is shaded with —
   * should keep tracking it, or a creature frozen at dusk stays lit as
   * it was when it froze (or as the pool's default, if it streamed in
   * frozen).
   */
  updateFrozen?: () => void;

  setHidden?: (hidden: boolean) => void;

  snapToTarget?: () => void;

  /**
   * This entity's own {@link EntitiesOptions.offscreenUpdateInterval}
   * (1: every frame, wherever it is). Unset, it takes the option.
   */
  offscreenUpdateInterval?: number;

  /**
   * Blocks around the entity that bound what it draws, for the off-screen
   * test: around its group's `position`, or around the position the server
   * last gave it when its class leaves the group at the origin and poses a
   * child in world space. Unset, {@link OFFSCREEN_DEFAULT_RADIUS}.
   */
  offscreenRadius?: number;
}

/** {@link Entity.offscreenRadius} when an entity names none. */
export const OFFSCREEN_DEFAULT_RADIUS = 2;
/**
 * Blocks past an entity's radius that still count as on screen: its
 * shadow, a limb swung out, and the frames before the view turns to it.
 */
const OFFSCREEN_MARGIN = 4;
/** Within this many blocks of the camera an entity updates every frame. */
const OFFSCREEN_NEAR_DISTANCE = 16;

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

  /**
   * Seconds a released entity's tick watermark is kept so a late,
   * out-of-order UPDATE for it cannot resurrect it. Reordering on the
   * unordered lane is a matter of seconds; past this the watermark is
   * dropped, which is what keeps the map from growing by one entry for
   * every creature that ever streamed past the player.
   */
  releasedTickRetentionSeconds: number;

  /**
   * Frames between updates of an entity outside the camera's view and
   * farther than a few blocks from it, staggered across entities (1: every
   * entity every frame). An entity whose motion and pose follow the clock
   * (damping and springs by elapsed time, poses from the shader clock)
   * only coarsens what nobody sees. A herd posed every frame behind the
   * player was most of a crowded frame. Needs the camera passed to
   * {@link Entities.update}.
   */
  offscreenUpdateInterval: number;

  /**
   * Blocks around an entity that bound what it draws, for an entity that
   * names no {@link Entity.offscreenRadius} of its own: the one place for a
   * game whose classes share a way to say what they draw (a pool slot, a
   * model), instead of a number on each class. Asked on the entity's turn
   * of `offscreenUpdateInterval` and remembered in between. An answer under
   * {@link OFFSCREEN_DEFAULT_RADIUS}, or none, leaves the default.
   */
  offscreenRadiusOf?: (entity: Entity) => number | undefined;

  /**
   * The physics engine to keep entities' replicated colliders in, usually
   * `world.physics`: the boxes a server's `CollidersComp` gives an entity
   * (its `colliders` metadata), placed at its replicated position for as
   * long as it is in range, so the player stops at them as at blocks.
   * Without one, colliders are ignored.
   *
   * @example
   * ```ts
   * const entities = new VOXELIZE.Entities({ physics: world.physics });
   * ```
   */
  physics: PhysicsEngine | null;
};

const defaultOptions: EntitiesOptions = {
  stalenessTimeoutSeconds: 10,
  streamSilenceGraceSeconds: 3,
  releasedTickRetentionSeconds: 30,
  offscreenUpdateInterval: 1,
  physics: null,
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
/**
 * Method that asks the server for the world's on-request entity metadata
 * keys (debug views it replicates only on request) or stops them.
 */
export const ON_REQUEST_METADATA_METHOD = "vox-builtin:on-request-metadata";

export class Entities extends Group implements NetIntercept {
  public map: Map<string, Entity> = new Map();

  /** Requests for the server (see `setOnRequestMetadata`). */
  public packets: MessageProtocol[] = [];

  private isOnRequestMetadataWanted = false;
  public types: Map<
    string,
    (new (id: string) => Entity) | ((id: string) => Entity)
  > = new Map();

  public options: EntitiesOptions;

  private liveness: EntityLivenessTracker;

  private unregisteredTypes = new Set<string>();

  private erroredApplySignatures = new Set<string>();

  /**
   * Per-entity server tick of the last applied state, so out-of-order frames
   * on unordered transports (WebRTC) can never rewind an entity.
   */
  private lastAppliedTick: Map<string, number> = new Map();

  /**
   * Released entities whose watermark is still held, keyed to the second
   * they were released. Insertion order is release order, so the sweep in
   * `update` stops at the first entry inside the retention window.
   */
  private releasedAt: Map<string, number> = new Map();

  /**
   * Wall-clock ms of the last motion-bearing apply per entity, plus the gap
   * samples of the current reporting window (perf logging only).
   */
  private lastMotionApplyMs: Map<string, number> = new Map();

  private motionGapSamples: number[] = [];

  private motionGapWindowStartMs = 0;

  /**
   * Each entity's replicated colliders in the physics engine, with the
   * position and boxes they were placed from.
   */
  private colliders: Map<
    string,
    {
      collider: Collider;
      position: [number, number, number];
      boxes: JsonValue;
    }
  > = new Map();

  private malformedColliderTypes = new Set<string>();

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
   * The server tick stamp of the newest state applied for entity `id`, or
   * `undefined` before any stamped message reached it. A client can name it
   * in a request that acts on what it sees, so an authoritative server can
   * tell how old that view was, however long the message queue held it,
   * and resolve the request against the entity as the client saw it.
   */
  /**
   * Receive the world's on-request entity metadata keys, or stop. A world
   * keeps metadata only a debug view reads (and that changes every tick)
   * out of every client's updates unless asked; ask while such a view is
   * shown. Kept across reconnects: a fresh session is asked again.
   */
  setOnRequestMetadata = (isWanted: boolean) => {
    if (isWanted === this.isOnRequestMetadataWanted) return;
    this.isOnRequestMetadataWanted = isWanted;
    this.requestOnRequestMetadata();
  };

  private requestOnRequestMetadata() {
    this.packets.push({
      type: "METHOD",
      method: {
        name: ON_REQUEST_METADATA_METHOD,
        payload: JSON.stringify({ on: this.isOnRequestMetadataWanted }),
      },
    } as MessageProtocol);
  }

  appliedTick = (id: string): number | undefined => {
    return this.lastAppliedTick.get(id);
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
      if (this.isOnRequestMetadataWanted) this.requestOnRequestMetadata();
    }

    const { entities } = message;
    const messageTick = typeof message.tick === "number" ? message.tick : 0;

    if (entities && entities.length) {
      const isLogging = isPerfLogging();
      const applyStartMs = isLogging ? performance.now() : 0;
      let failedCount = 0;

      entities.forEach((entity) => {
        try {
          this.applyEntityOperation(
            entity,
            messageTick,
            nowSeconds,
            isLogging,
            message.perfTraceId ?? "",
          );
        } catch (error) {
          // One faulty entity — a malformed payload or a throwing game
          // callback — must never poison the rest of the batch: an aborted
          // batch freezes every other entity in the message, and an error
          // escaping this interceptor aborts everything queued behind the
          // message (chunks included). Log, isolate, continue.
          failedCount += 1;
          const description =
            error instanceof Error ? error.message : String(error);
          if (isLogging) {
            logPerf("entity_apply_error", {
              traceId: message.perfTraceId ?? "",
              entityId: entity.id,
              entityType: entity.type,
              operation: entity.operation,
              error: description,
            });
          }
          this.reportApplyError(entity.type, entity.operation, error);
        }
      });

      if (isLogging) {
        logPerf("entity_apply", {
          traceId: message.perfTraceId ?? "",
          itemCount: entities.length,
          failedCount,
          byteSize: message.perfByteSize ?? 0,
          durationMs: performance.now() - applyStartMs,
        });
      }
    }
  };

  private applyEntityOperation = (
    entity: EntityProtocol<MutableMetadata | null>,
    messageTick: number,
    nowSeconds: number,
    isLogging: boolean,
    perfTraceId: string,
  ) => {
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
        traceId: perfTraceId,
        operation,
        entityId: id,
        entityType: type,
      });
    }

    switch (operation) {
      case "CREATE": {
        // CREATE always applies, no staleness check: it is the
        // reliable, ordered, complete snapshot. A partial UPDATE that
        // raced ahead on an unordered transport may have stamped a
        // newer tick, but skipping the CREATE would leave the entity
        // permanently incomplete; the watermark is monotonic, so
        // applying the snapshot never lowers out-of-order protection.
        if (object) {
          // The server streams a fresh snapshot for an entity it believes
          // is new to us, so resync our stale copy to it.
          object.metadata = metadata;
          object.onUpdate?.(metadata);
          object.snapToTarget?.();
          this.syncColliders(object, metadata);
          this.noteAppliedTick(id, messageTick);
          this.liveness.touchEntity(id, nowSeconds);
          return;
        }

        object = this.createEntityOfType(type, id);
        if (object) {
          object.metadata = metadata;
          object.onCreate?.(metadata);
          this.syncColliders(object, metadata);
          this.noteAppliedTick(id, messageTick);
          this.liveness.touchEntity(id, nowSeconds);
          this.releasedAt.delete(id);
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
          // Only a COMPLETE snapshot may construct an entity. Full
          // snapshots (legacy servers, old-server healing) always
          // carry the engine-written `position`; compact
          // metadata-lane payloads are partial projections and never
          // do. Constructing from a partial snapshot hands game
          // callbacks metadata missing the keys they iterate
          // (position, direction, ...) — the exact shape that broke
          // game clients in production. Partial state waits for the
          // reliable CREATE.
          if (!metadata || metadata.position === undefined) {
            return;
          }
          object = this.createEntityOfType(type, id);
          if (object) {
            object.metadata = metadata;
            object.onCreate?.(metadata);
            this.releasedAt.delete(id);
          }
        }

        if (object) {
          // Merge instead of replace: compact-protocol servers send
          // motion and non-motion state independently, and metadata
          // keys are never removed server-side, so the accumulated map
          // always presents the full legacy shape to game code.
          const merged = mergeMetadataUpdate(
            object.metadata as MutableMetadata | null,
            metadata as MutableMetadata | null,
          );
          if (motion) {
            applyMotionToMetadata(merged, motion);
          }
          object.metadata = merged;
          object.onUpdate?.(merged);
          this.syncColliders(object, merged);
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
          // Nothing to release, but the watermark just written still has
          // to expire: a lifecycle event for an entity that never got
          // constructed here (it left range before its CREATE landed) is
          // the common case while streaming past a shoal.
          if (this.lastAppliedTick.has(id) && !this.releasedAt.has(id)) {
            this.releasedAt.set(id, nowSeconds);
          }
          return;
        }

        this.releaseEntity(object, metadata ?? object.metadata);

        break;
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

  /** Scratch for the off-screen test, and each entity's stagger. */
  private readonly view = {
    frustum: new Frustum(),
    matrix: new Matrix4(),
    sphere: new Sphere(),
    place: new Vector3(),
    frame: 0,
    phases: new WeakMap<Entity, number>(),
    nextPhase: 0,
    askedRadii: new WeakMap<Entity, number>(),
  };

  /**
   * The radius of the sphere the off-screen test puts around `entity`: its
   * own {@link Entity.offscreenRadius}, else what
   * {@link EntitiesOptions.offscreenRadiusOf} last answered for it (asked
   * again when `isRefreshing`), else the default.
   */
  private boundOf(entity: Entity, isRefreshing: boolean): number {
    const own = entity.offscreenRadius;
    if (own !== undefined) return own;
    const ask = this.options.offscreenRadiusOf;
    if (!ask) return OFFSCREEN_DEFAULT_RADIUS;
    const asked = this.view.askedRadii;
    let radius = isRefreshing ? undefined : asked.get(entity);
    if (radius === undefined) {
      radius = Math.max(OFFSCREEN_DEFAULT_RADIUS, ask(entity) ?? 0);
      asked.set(entity, radius);
    }
    return radius;
  }

  /**
   * Where `entity` is, for the distance and off-screen tests: its group's
   * position, or, for a class that leaves the group at the origin and poses
   * a child in world space, the position the server last gave it. Judged by
   * its group alone, such an entity stood at the world origin: in plain view
   * anywhere else, it was posed on one frame in
   * {@link EntitiesOptions.offscreenUpdateInterval}. The answer is a
   * scratch vector, good until the next call.
   */
  private placeOf(entity: Entity): Vector3 {
    const own = entity.position;
    if (own.x !== 0 || own.y !== 0 || own.z !== 0) return own;
    const replicated = (entity.metadata as MutableMetadata | null)?.position;
    if (!Array.isArray(replicated)) return own;
    const [x, y, z] = replicated;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number"
    ) {
      return own;
    }
    return this.view.place.set(x, y, z);
  }

  /**
   * Whether `entity` sits out this frame: off screen, away from the camera,
   * and not on its turn of {@link EntitiesOptions.offscreenUpdateInterval}.
   */
  private skipsOffscreen(entity: Entity, cameraPos: Vector3): boolean {
    const interval =
      entity.offscreenUpdateInterval ?? this.options.offscreenUpdateInterval;
    if (interval <= 1) return false;
    const view = this.view;
    let phase = view.phases.get(entity);
    if (phase === undefined) {
      phase = view.nextPhase++;
      view.phases.set(entity, phase);
    }
    if ((view.frame + phase) % interval === 0) {
      // A body that grew or changed since its last turn is bounded anew.
      this.boundOf(entity, true);
      return false;
    }
    const radius = this.boundOf(entity, false);
    // Near is measured to the body, not its middle: a long one counts as
    // close while any of it is.
    const near =
      OFFSCREEN_NEAR_DISTANCE + Math.max(0, radius - OFFSCREEN_DEFAULT_RADIUS);
    const place = this.placeOf(entity);
    if (place.distanceToSquared(cameraPos) < near * near) {
      return false;
    }
    view.sphere.center.copy(place);
    view.sphere.radius = radius + OFFSCREEN_MARGIN;
    return !view.frustum.intersectsSphere(view.sphere);
  }

  update = (cameraPos?: Vector3, renderDistance?: number, camera?: Camera) => {
    const nowSeconds = performance.now() / 1000;
    for (const id of this.liveness.collectStale(nowSeconds)) {
      const object = this.map.get(id);
      if (object) {
        this.releaseEntity(object, object.metadata);
      } else {
        this.liveness.forget(id);
      }
    }
    this.forgetExpiredWatermarks(nowSeconds);

    const renderDistSq =
      cameraPos && renderDistance ? renderDistance * renderDistance : 0;

    const view = this.view;
    view.frame += 1;
    const isViewKnown = camera !== undefined && cameraPos !== undefined;
    if (isViewKnown) {
      view.matrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      view.frustum.setFromProjectionMatrix(
        view.matrix,
        camera.coordinateSystem,
        camera.reversedDepth,
      );
    }

    this.map.forEach((entity) => {
      if (renderDistSq > 0 && cameraPos && entity.setHidden) {
        const isTooFar =
          this.placeOf(entity).distanceToSquared(cameraPos) > renderDistSq;
        entity.setHidden(isTooFar);
        if (isTooFar) {
          // Keep tracking the server position while invisible so the entity
          // reappears exactly where the server says it is.
          entity.snapToTarget?.();
          return;
        }
      }

      // A server-frozen entity holds whatever pose it last rendered: its
      // class update (animation clocks, interpolation, bone writes) is
      // skipped, while position bookkeeping stays pinned to the replicated
      // transform so hitboxes and nametags sit at server truth, and its
      // world-driven state (lighting) keeps up through `updateFrozen`.
      if (isEntityMetadataFrozen(entity.metadata as MutableMetadata | null)) {
        entity.snapToTarget?.();
        entity.updateFrozen?.();
        return;
      }

      if (isViewKnown && this.skipsOffscreen(entity, cameraPos)) return;
      entity.update?.();
    });
  };

  snapAllToTarget = () => {
    this.map.forEach((entity) => {
      entity.snapToTarget?.();
    });
  };

  /**
   * Keep an entity's replicated colliders (its `colliders` metadata, boxes
   * relative to its position) in the physics engine, placed at its
   * replicated position. Only a changed position or set of boxes moves
   * them; a box the engine would refuse is left out, and said so once per
   * entity type.
   */
  private syncColliders = (
    object: Entity,
    metadata: MutableMetadata | null | undefined,
  ) => {
    const { physics } = this.options;
    if (!physics) return;

    const id = object.entId;
    const existing = this.colliders.get(id);
    const boxes = metadata?.colliders;
    const position = metadata?.position;
    if (!Array.isArray(boxes) || boxes.length === 0 || !isCoords3(position)) {
      this.dropColliders(id);
      return;
    }

    if (
      existing &&
      existing.position.every((v, i) => v === position[i]) &&
      isSameColliderBoxes(existing.boxes, boxes)
    ) {
      return;
    }

    const aabbs: AABB[] = [];
    for (const box of boxes) {
      const aabb = placeColliderBox(box, position);
      if (aabb) {
        aabbs.push(aabb);
      } else {
        this.reportMalformedColliderBox(object.entType, box);
      }
    }

    if (existing) {
      physics.updateCollider(existing.collider, aabbs);
      existing.position = [...position];
      existing.boxes = boxes;
    } else {
      this.colliders.set(id, {
        collider: physics.addCollider(aabbs),
        position: [...position],
        boxes,
      });
    }
  };

  private dropColliders = (id: string) => {
    const existing = this.colliders.get(id);
    if (!existing) return;
    this.options.physics?.removeCollider(existing.collider);
    this.colliders.delete(id);
  };

  private reportMalformedColliderBox = (entityType: string, box: JsonValue) => {
    if (this.malformedColliderTypes.has(entityType)) return;
    this.malformedColliderTypes.add(entityType);
    console.warn(
      `[entities] Entity type "${entityType}" replicated the collider box ${JSON.stringify(box)}, ` +
        `which is not [minX, minY, minZ, maxX, maxY, maxZ] with finite bounds and min < max on every axis; ` +
        `it is left out. Further bad boxes for this type are not reported.`,
    );
  };

  private releaseEntity = (object: Entity, metadata: Entity["metadata"]) => {
    this.map.delete(object.entId);
    this.liveness.forget(object.entId);
    this.lastMotionApplyMs.delete(object.entId);
    this.dropColliders(object.entId);
    // lastAppliedTick is kept for now: it is what blocks an out-of-order
    // state frame from resurrecting the released entity. It expires after
    // `releasedTickRetentionSeconds` (see forgetExpiredWatermarks) and is
    // cleared wholesale on INIT (a fresh server session).
    if (this.lastAppliedTick.has(object.entId)) {
      // Re-insert so the entry sits at the end of the release order even
      // if this id was released once before.
      this.releasedAt.delete(object.entId);
      this.releasedAt.set(object.entId, performance.now() / 1000);
    }

    object.parent?.remove(object);
    object.onDelete?.(metadata);
    // Whatever the entity's own cleanup did, nothing under it is drawn
    // again: its labels are freed, and the renderer is told to let go of
    // every drawable (meshes on shared materials no one disposes, a name
    // tag drawn once): otherwise each entity that ever walked out of range
    // stayed alive behind its render objects.
    object.traverse((child) => {
      if (child instanceof SpriteText) child.dispose();
    });
    releaseObject(object);
  };

  /**
   * Drop the watermarks of entities released longer ago than the retention
   * window. Without this the map held one entry for every entity that ever
   * streamed into range: swimming past reefs and shoals for an hour left
   * thousands of ids nothing would ever read again.
   */
  private forgetExpiredWatermarks = (nowSeconds: number) => {
    const cutoff = nowSeconds - this.options.releasedTickRetentionSeconds;
    for (const [id, releasedAt] of this.releasedAt) {
      if (releasedAt > cutoff) break;
      this.releasedAt.delete(id);
      this.lastAppliedTick.delete(id);
    }
  };

  private releaseAllEntities = () => {
    for (const object of [...this.map.values()]) {
      this.releaseEntity(object, object.metadata);
    }
    this.lastAppliedTick.clear();
    this.releasedAt.clear();
  };

  /**
   * Console-reports an entity apply failure once per (type, operation)
   * signature. Streaming entities re-send continuously, so an unthrottled
   * report would flood the console at tick rate while adding nothing.
   */
  private reportApplyError = (
    entityType: string,
    operation: EntityOperation,
    error: Error | string | number | boolean | null | undefined,
  ) => {
    const signature = `${entityType}:${operation}`;
    if (this.erroredApplySignatures.has(signature)) {
      return;
    }
    this.erroredApplySignatures.add(signature);
    console.error(
      `[entities] Applying a "${operation}" for entity type "${entityType}" failed; ` +
        `further errors for this type and operation are suppressed.`,
      error,
    );
  };

  private isStaleFrame = (id: string, messageTick: number) => {
    if (messageTick <= 0) {
      return false;
    }
    const lastTick = this.lastAppliedTick.get(id);
    return lastTick !== undefined && messageTick <= lastTick;
  };

  private noteAppliedTick = (id: string, messageTick: number) => {
    if (messageTick <= 0) {
      return;
    }
    // Monotonic max-only: a lifecycle event captured at an older tick than
    // already-applied state (possible when reliable and unordered lanes
    // interleave) must never LOWER the watermark — that would reopen the
    // window for an in-between stale UPDATE to resurrect or rewind.
    const lastTick = this.lastAppliedTick.get(id);
    if (lastTick === undefined || messageTick > lastTick) {
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
