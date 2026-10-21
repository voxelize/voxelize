import * as THREE from "three";

import { Entity } from "../../core/entities";
import type { World } from "../../core/world";
import type { Coords3 } from "../../types";
import { dampPosition } from "../motion/damp-position";
import { shortestYawDelta } from "../motion/yaw";

import type {
  SkinnedInstancePool,
  SkinnedRigInfo,
} from "./skinned-instance-pool";

/** The metadata an instanced entity reads from the server's stream. */
export interface InstancedEntityData {
  position: Coords3;
  /** Facing as a direction vector; only its yaw is used. */
  direction?: number[];
  variant?: string;
  baby?: boolean;
  /** Uniform scale of the whole body. */
  size?: number;
}

export interface InstancedEntityOptions {
  world?: World | null;
  /**
   * The light an instance standing at a point is shaded with (multiplier
   * for its albedo). `LightShined.lightAt` fits; instances stay at the
   * pool's white default when this is unset.
   */
  lightAt?: (position: THREE.Vector3) => THREE.Color | null;
  /** Frames between light samples (staggered per entity). Defaults to 3. */
  lightIntervalFrames?: number;
}

let nextEntityOrdinal = 0;
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
/// Per-frame steps clamp to this, so a hitch does not fling a pose.
const MAX_STEP_SECONDS = 0.1;

/**
 * An entity drawn as one slot of a {@link SkinnedInstancePool}. It holds the
 * slot for its lifetime, follows the server's position and facing with
 * damping, writes its instance matrix and voxel light, and calls
 * {@link animate} each frame for the family's bone pose.
 *
 * A family subclasses it and implements `animate`, posing bones with
 * {@link setBone} (each matrix rotates the bone's boxes about their pivot).
 *
 * @example
 * ```ts
 * class Walker extends InstancedEntity {
 *   protected animate(time: number) {
 *     const swing = Math.sin(time * 6) * 0.5 * this.movement;
 *     this.setBone(BONE.LEG_L, this.boneMatrix.makeRotationX(swing));
 *     this.setBone(BONE.LEG_R, this.boneMatrix.makeRotationX(-swing));
 *   }
 * }
 * entities.setClass("walker", (id) => new Walker(id, walkerPool, { world }));
 * ```
 */
export abstract class InstancedEntity<
  TData extends InstancedEntityData = InstancedEntityData,
  TVariant extends string = string,
> extends Entity<TData> {
  protected slot = -1;
  protected rig: SkinnedRigInfo | null = null;
  protected variant: TVariant;
  protected isBaby = false;
  protected size = 1;

  /** Where the server last put the entity; `position` damps toward it. */
  readonly targetPosition = new THREE.Vector3();
  protected targetYaw = 0;
  protected yaw = 0;
  /** Fraction of the gap closed per frame. */
  protected positionDamping = 0.2;
  protected yawDamping = 0.22;
  /**
   * 0 at rest, 1 while travelling, eased between: the walk-versus-idle blend
   * a pose usually scales its swing by.
   */
  protected movement = 0;

  /** The instance matrix as last written (identity before the first). */
  protected readonly instanceWorldMatrix = new THREE.Matrix4();
  /** Scratch for `animate`; reuse rather than allocate per frame. */
  protected readonly boneMatrix = new THREE.Matrix4();

  protected world: World | null;
  private readonly pool: SkinnedInstancePool<TVariant> | null;
  private readonly lightAt: InstancedEntityOptions["lightAt"];
  private readonly lightIntervalFrames: number;
  private readonly ordinal = nextEntityOrdinal++;
  private hidden = false;
  private lastFrameMs = 0;
  private ownTime = 0;
  private frameCount = 0;

  private readonly tempEuler = new THREE.Euler();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempScale = new THREE.Vector3();

  constructor(
    id: string,
    pool: SkinnedInstancePool<TVariant> | null,
    options: InstancedEntityOptions = {},
  ) {
    super(id);
    this.pool = pool;
    this.world = options.world ?? null;
    this.lightAt = options.lightAt;
    this.lightIntervalFrames = Math.max(1, options.lightIntervalFrames ?? 3);
    this.variant = (pool?.config.variants[0] ?? "") as TVariant;
  }

  /**
   * Poses the bones for this frame. `time` is the world's shader clock in
   * seconds (every client agrees on it), `deltaTime` the frame step.
   */
  protected abstract animate(time: number, deltaTime: number): void;

  /** The pool the slot lives in. Override to resolve it lazily. */
  protected getPool(): SkinnedInstancePool<TVariant> | null {
    return this.pool;
  }

  /** Which variant the data asks for; `data.variant` by default. */
  protected readVariant(data: TData): TVariant | undefined {
    return data.variant as TVariant | undefined;
  }

  /** Family-specific fields of every message, the creation one included. */
  protected onData(_data: TData): void {}

  /** Body pitch and roll (radians), folded into the instance matrix. */
  protected bodyPitch(): number {
    return 0;
  }

  protected bodyRoll(): number {
    return 0;
  }

  onCreate = (data: TData) => {
    this.readCommon(data);
    this.acquireSlot();
    this.position.set(...data.position);
    this.targetPosition.set(...data.position);
    this.yaw = this.targetYaw;
    this.onData(data);
    this.writeInstanceMatrix();
    this.animate(this.readTime(0), 0);
    // Lit from its first frame: an entity that streams in still may not
    // move again for a while.
    this.refreshLight(true);
  };

  onUpdate = (data: TData) => {
    const previousVariant = this.variant;
    const previousBaby = this.isBaby;
    this.readCommon(data);
    if (this.variant !== previousVariant || this.isBaby !== previousBaby) {
      this.reslot();
    }
    this.targetPosition.set(...data.position);
    this.onData(data);
  };

  onDelete = () => {
    this.releaseSlot();
  };

  snapToTarget = () => {
    this.position.copy(this.targetPosition);
    this.yaw = this.targetYaw;
  };

  setHidden = (hidden: boolean) => {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    const pool = this.getPool();
    if (hidden && pool && this.slot !== -1) {
      pool.setInstanceMatrix(this.slot, ZERO_MATRIX);
    }
  };

  /// While the server holds the entity frozen the pose holds, but the light
  /// is the world's, so dusk still reaches it.
  updateFrozen = () => {
    this.refreshLight();
  };

  update = () => {
    if (this.slot === -1 || !this.getPool()) return;
    const now = performance.now();
    const deltaTime =
      this.lastFrameMs === 0
        ? 0
        : Math.min((now - this.lastFrameMs) / 1000, MAX_STEP_SECONDS);
    this.lastFrameMs = now;
    this.frameCount++;

    this.resolveMotion(deltaTime);
    if (!this.hidden) this.writeInstanceMatrix();
    this.animate(this.readTime(deltaTime), deltaTime);
    this.refreshLight();
  };

  /** Flashes the instance red, fading over a third of a second. */
  markHit = () => {
    const pool = this.getPool();
    if (pool && this.slot !== -1) pool.markHit(this.slot);
  };

  /** Sets one bone's matrix, relative to the bone's pivot. */
  protected setBone(boneIndex: number, matrix: THREE.Matrix4): void {
    const pool = this.getPool();
    if (pool && this.slot !== -1)
      pool.setBoneMatrix(this.slot, boneIndex, matrix);
  }

  protected get isHidden(): boolean {
    return this.hidden;
  }

  /**
   * Damps `position` and `yaw` toward the stream at the same speed whatever
   * the frame rate (a far jump snaps); override to attach to a rider.
   */
  protected resolveMotion(_deltaTime: number): void {
    const gap = this.targetPosition.distanceTo(this.position);
    dampPosition(this.position, this.targetPosition, this.positionDamping);
    this.yaw += shortestYawDelta(this.yaw, this.targetYaw) * this.yawDamping;
    const isMoving = gap > 0.002;
    this.movement +=
      ((isMoving ? 1 : 0) - this.movement) * (isMoving ? 0.08 : 0.05);
  }

  /** Builds the instance matrix: position, yaw/pitch/roll, `size`. */
  protected composeInstanceMatrix(out: THREE.Matrix4): void {
    this.tempEuler.set(this.bodyPitch(), this.yaw, this.bodyRoll(), "YXZ");
    this.tempQuat.setFromEuler(this.tempEuler);
    this.tempScale.setScalar(this.size);
    out.compose(this.position, this.tempQuat, this.tempScale);
  }

  protected writeInstanceMatrix(): void {
    const pool = this.getPool();
    if (!pool || this.slot === -1) return;
    this.composeInstanceMatrix(this.instanceWorldMatrix);
    pool.setInstanceMatrix(this.slot, this.instanceWorldMatrix);
  }

  /** Samples the voxel light into the instance, every few frames. */
  protected refreshLight(force = false): void {
    const pool = this.getPool();
    if (!this.lightAt || !pool || this.slot === -1) return;
    if (
      !force &&
      (this.frameCount + this.ordinal) % this.lightIntervalFrames !== 0
    ) {
      return;
    }
    const color = this.lightAt(this.position);
    if (color) pool.setInstanceLightColor(this.slot, color.r, color.g, color.b);
  }

  /** Takes a slot for the current variant; a full pool leaves it at -1. */
  protected acquireSlot(): void {
    const pool = this.getPool();
    if (!pool || this.slot !== -1) return;
    this.slot = pool.allocate(this.variant, this.isBaby);
    this.rig =
      this.slot === -1
        ? null
        : pool.getRigInfo(this.variant, this.isBaby) ?? null;
  }

  protected releaseSlot(): void {
    const pool = this.getPool();
    if (pool && this.slot !== -1) pool.free(this.slot);
    this.slot = -1;
    this.rig = null;
  }

  /// The mesh lives in the old variant's pool, so a live variant change
  /// moves the slot or the body never changes.
  protected reslot(): void {
    if (this.slot === -1) return;
    this.releaseSlot();
    this.acquireSlot();
    this.writeInstanceMatrix();
    this.refreshLight(true);
  }

  private readCommon(data: TData): void {
    if (data.size !== undefined) this.size = data.size;
    if (data.baby !== undefined) this.isBaby = data.baby;
    const variant = this.readVariant(data);
    if (variant !== undefined) this.variant = variant;
    const direction = data.direction;
    if (direction && direction.length >= 3) {
      this.targetYaw = Math.atan2(direction[0], direction[2]);
    }
  }

  private readTime(deltaTime: number): number {
    const clock = this.world?.shaderClock;
    if (clock) return clock.wrappedSeconds;
    this.ownTime += deltaTime;
    return this.ownTime;
  }
}
