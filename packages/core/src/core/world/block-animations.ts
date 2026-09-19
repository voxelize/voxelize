import { Matrix4, Mesh, Quaternion, Vector3 } from "three";

import { Coords3 } from "../../types";
import { BlockUtils } from "../../utils";

import { Block, BlockRotation } from "./block";

/**
 * Block animations: a block whose voxel state changed moves from the pose it
 * showed into the pose it shows now, instead of cutting between them.
 *
 * The voxel word stays the only authority — a door is open because its
 * `stage` says so, on the server and on every client — and its geometry per
 * state is still whatever the mesher builds from the block's dynamic
 * patterns. What this adds is purely cosmetic and derived from the
 * replicated state: an `is_animated` block is meshed one geometry per voxel
 * (`Block.isAnimated`), each such mesh is tagged with its voxel, and when a
 * remesh lands showing a different state than the mesh before it, the new
 * geometry is placed at the old pose and eased into its own. Lighting needs
 * no special handling: the moving mesh is the chunk's own geometry, so it
 * wears the chunk material with the vertex light the mesher baked for that
 * voxel.
 *
 * A {@link BlockAnimation} describes the motion in the block's own unrotated
 * frame; the voxel's rotation is applied here, so one declaration serves
 * every facing the block can be placed in. To animate a block: give it
 * `.is_animated(true)` in the server registry, then
 * `world.blockAnimations.register(names, animation)` on the client.
 */

/** The voxel state a rest pose is asked for. */
export type BlockAnimationState = {
  /** The packed voxel word, for anything the two fields below leave out. */
  raw: number;
  stage: number;
  rotation: BlockRotation;
};

/**
 * Where a state's geometry rests, relative to the stage-0 geometry: turned
 * `angle` radians about the hinge, and displaced by `offset` (block-local,
 * before the block's rotation).
 */
export type BlockRestPose = {
  angle: number;
  offset?: Coords3;
};

export type BlockAnimationEasing = (t: number) => number;

export type BlockAnimation = {
  /** The hinge point, in the block's unrotated 0..1 frame. */
  pivot: Coords3;
  /** The hinge axis, in the same frame; it turns with the block. */
  axis: Coords3;
  /** The rest pose of a voxel in the given state. */
  restPose: (state: BlockAnimationState) => BlockRestPose;
  /** How long a move between two rest poses takes. */
  durationMs: number;
  /** Progress curve over 0..1; defaults to {@link easeOutCubic}. */
  easing?: BlockAnimationEasing;
};

export const easeOutCubic: BlockAnimationEasing = (t) => 1 - (1 - t) ** 3;

/** The state {@link BlockAnimations.snapshot} reports. */
export type BlockAnimationsSnapshot = {
  /** Lower-cased block names with a declared motion. */
  registered: string[];
  trackedCount: number;
  activeCount: number;
  voxels: {
    voxel: Coords3;
    block: string;
    stage: number;
    angle: number;
    restAngle: number;
    progress: number;
    isMoving: boolean;
  }[];
};

/** What the animations read from the world. */
export interface BlockAnimationHost {
  getBlockByIdSafe(id: number): Block | undefined;
  getRawVoxelAt(vx: number, vy: number, vz: number): number;
}

type Motion = {
  fromAngle: number;
  fromOffset: Vector3;
  startMs: number;
  durationMs: number;
};

type AnimatedVoxel = {
  key: string;
  voxel: Coords3;
  mesh: Mesh;
  /** The mesh's placed matrix: the pose its geometry rests in. */
  rest: Matrix4;
  /** The voxel word this mesh depicts. */
  raw: number;
  block: Block;
  animation: BlockAnimation;
  pivotWorld: Vector3;
  axisWorld: Vector3;
  restAngle: number;
  /** The rest displacement, turned into the voxel's frame. */
  restOffset: Vector3;
  motion: Motion | null;
};

/** Below this the pose is the rest pose: no motion to run, no matrix to compose. */
const POSE_EPSILON = 1e-4;

const scratchMatrix = new Matrix4();
const scratchRotation = new Matrix4();
const scratchUnpivot = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchTranslation = new Vector3();
const scratchOffset = new Vector3();

function voxelKey(vx: number, vy: number, vz: number): string {
  return `${vx},${vy},${vz}`;
}

function sectionKey(cx: number, cz: number, level: number): string {
  return `${cx},${cz}:${level}`;
}

/** Same block, same facing: the two words describe poses in one frame. */
function isSameFrame(a: number, b: number): boolean {
  return (a & 0x00ffffff) === (b & 0x00ffffff);
}

/**
 * Apply the voxel's rotation to a point of its unrotated frame, the way the
 * mesher turned the geometry's corners.
 */
function rotatePoint(
  point: Coords3,
  block: Block,
  rotation: BlockRotation,
): Coords3 {
  const out: Coords3 = [point[0], point[1], point[2]];
  if (block.rotatable || block.yRotatable) {
    rotation.rotateNode(out, block.yRotatable, true);
  }
  return out;
}

export class BlockAnimations {
  private animations = new Map<string, BlockAnimation>();

  /** Every animated voxel with a mesh, by the section that owns the mesh. */
  private sections = new Map<string, Map<string, AnimatedVoxel>>();

  private byVoxel = new Map<string, AnimatedVoxel>();

  private active = new Set<AnimatedVoxel>();

  constructor(private host: BlockAnimationHost) {}

  /**
   * Declare how the named blocks move between their states. Names are
   * matched case-insensitively, as the registry keys them. Returns a
   * disposer that forgets the declaration again.
   */
  register(names: string | string[], animation: BlockAnimation): () => void {
    const list = (Array.isArray(names) ? names : [names]).map((name) =>
      name.toLowerCase(),
    );
    for (const name of list) {
      this.animations.set(name, animation);
    }
    return () => {
      for (const name of list) {
        if (this.animations.get(name) === animation) {
          this.animations.delete(name);
        }
      }
    };
  }

  get(block: Block): BlockAnimation | undefined {
    return this.animations.get(block.name.toLowerCase());
  }

  /** Voxels currently moving; a diagnostic for tests and the agent. */
  get activeCount(): number {
    return this.active.size;
  }

  /** Voxels with a tracked mesh, moving or at rest. */
  get trackedCount(): number {
    return this.byVoxel.size;
  }

  /**
   * What the animations know right now, for the agent harness: the block
   * names with a declared motion, and every tracked voxel with the pose it
   * is showing. `angle` is radians about the hinge from the stage-0 pose;
   * `progress` is 1 at rest.
   */
  snapshot(nowMs: number): BlockAnimationsSnapshot {
    const voxels: BlockAnimationsSnapshot["voxels"] = [];
    for (const entry of this.byVoxel.values()) {
      const { angle, progress } = this.poseAt(entry, nowMs);
      voxels.push({
        voxel: [entry.voxel[0], entry.voxel[1], entry.voxel[2]],
        block: entry.block.name,
        stage: BlockUtils.extractStage(entry.raw),
        angle,
        restAngle: entry.restAngle,
        progress,
        isMoving: entry.motion !== null,
      });
    }
    return {
      registered: [...this.animations.keys()].sort(),
      trackedCount: this.byVoxel.size,
      activeCount: this.active.size,
      voxels,
    };
  }

  /**
   * The meshes of one chunk section just landed. Every animated voxel among
   * them is compared with the mesh it replaces: same state and the pose
   * carries over (a neighbour's edit remeshed the section mid-swing); a new
   * state and the leaf starts moving from where it visibly was.
   */
  handleSectionMeshed(
    cx: number,
    cz: number,
    level: number,
    meshes: Mesh[],
    nowMs: number,
  ) {
    const section = sectionKey(cx, cz, level);
    const previous = this.sections.get(section);
    const next = new Map<string, AnimatedVoxel>();

    for (const mesh of meshes) {
      const at = mesh.userData?.animatedAt as Coords3 | undefined;
      if (!at) continue;
      const entry = this.makeEntry(at, mesh);
      if (!entry) continue;

      const prev = previous?.get(entry.key);
      if (prev) {
        this.active.delete(prev);
        this.continueFrom(prev, entry, nowMs);
      }

      next.set(entry.key, entry);
      this.byVoxel.set(entry.key, entry);
      if (entry.motion) {
        this.active.add(entry);
      }
      this.applyPoseAt(entry, nowMs);
    }

    if (previous) {
      for (const [key, prev] of previous) {
        if (next.has(key)) continue;
        this.active.delete(prev);
        if (this.byVoxel.get(key) === prev) this.byVoxel.delete(key);
      }
    }

    if (next.size > 0) {
      this.sections.set(section, next);
    } else {
      this.sections.delete(section);
    }
  }

  /** The section's meshes are gone (chunk unloaded): forget its voxels. */
  handleSectionUnloaded(cx: number, cz: number, level: number) {
    const section = sectionKey(cx, cz, level);
    const entries = this.sections.get(section);
    if (!entries) return;
    for (const [key, entry] of entries) {
      this.active.delete(entry);
      if (this.byVoxel.get(key) === entry) this.byVoxel.delete(key);
    }
    this.sections.delete(section);
  }

  /** Advance every moving voxel to `nowMs`. Called once per frame. */
  update(nowMs: number) {
    if (this.active.size === 0) return;
    for (const entry of this.active) {
      // A mesh dropped without its section event (a memory-pressure purge)
      // is not ours to move any more.
      if (entry.mesh.parent === null) {
        this.active.delete(entry);
        entry.motion = null;
        continue;
      }
      const isSettled = this.applyPoseAt(entry, nowMs);
      if (isSettled) {
        entry.motion = null;
        this.active.delete(entry);
      }
    }
  }

  clear() {
    this.sections.clear();
    this.byVoxel.clear();
    this.active.clear();
  }

  private makeEntry(at: Coords3, mesh: Mesh): AnimatedVoxel | null {
    const [vx, vy, vz] = at;
    const raw = this.host.getRawVoxelAt(vx, vy, vz);
    const block = this.host.getBlockByIdSafe(BlockUtils.extractID(raw));
    if (!block) return null;
    const animation = this.get(block);
    if (!animation) return null;

    const rotation = BlockUtils.extractRotation(raw);
    const stage = BlockUtils.extractStage(raw);
    const pose = animation.restPose({ raw, stage, rotation });

    const pivot = rotatePoint(animation.pivot, block, rotation);
    const alongAxis = rotatePoint(
      [
        animation.pivot[0] + animation.axis[0],
        animation.pivot[1] + animation.axis[1],
        animation.pivot[2] + animation.axis[2],
      ],
      block,
      rotation,
    );
    const axisWorld = new Vector3(
      alongAxis[0] - pivot[0],
      alongAxis[1] - pivot[1],
      alongAxis[2] - pivot[2],
    ).normalize();

    const offset = pose.offset ?? [0, 0, 0];
    const displaced = rotatePoint(
      [
        animation.pivot[0] + offset[0],
        animation.pivot[1] + offset[1],
        animation.pivot[2] + offset[2],
      ],
      block,
      rotation,
    );

    return {
      key: voxelKey(vx, vy, vz),
      voxel: [vx, vy, vz],
      mesh,
      rest: mesh.matrix.clone(),
      raw,
      block,
      animation,
      pivotWorld: new Vector3(pivot[0] + vx, pivot[1] + vy, pivot[2] + vz),
      axisWorld,
      restAngle: pose.angle,
      restOffset: new Vector3(
        displaced[0] - pivot[0],
        displaced[1] - pivot[1],
        displaced[2] - pivot[2],
      ),
      motion: null,
    };
  }

  /**
   * Decide how `entry`, which replaces `prev` for the same voxel, starts.
   */
  private continueFrom(
    prev: AnimatedVoxel,
    entry: AnimatedVoxel,
    nowMs: number,
  ) {
    // Re-placed facing another way (or as another block): the poses live in
    // different frames, so there is nothing to move between.
    if (!isSameFrame(prev.raw, entry.raw)) return;

    if (prev.raw === entry.raw) {
      // Same state, new mesh: keep whatever swing was under way.
      entry.motion = prev.motion;
      return;
    }

    const { angle, offset } = this.poseAt(prev, nowMs);
    if (
      Math.abs(angle - entry.restAngle) < POSE_EPSILON &&
      offset.distanceToSquared(entry.restOffset) < POSE_EPSILON * POSE_EPSILON
    ) {
      return;
    }

    entry.motion = {
      fromAngle: angle,
      fromOffset: offset.clone(),
      startMs: nowMs,
      durationMs: entry.animation.durationMs,
    };
    this.syncWithPartners(entry, nowMs);
  }

  /**
   * A multi-voxel unit (a door's two leaves) is one object to the eye. Its
   * parts change state in one batch but may land in different sections on
   * different frames; a part that starts late adopts the swing its partner
   * already began so the two finish as one.
   */
  private syncWithPartners(entry: AnimatedVoxel, nowMs: number) {
    if (!entry.motion) return;
    for (const part of entry.block.coupledParts ?? []) {
      const partner = this.byVoxel.get(
        voxelKey(
          entry.voxel[0] + part.offset[0],
          entry.voxel[1] + part.offset[1],
          entry.voxel[2] + part.offset[2],
        ),
      );
      const motion = partner?.motion;
      if (!partner || !motion) continue;
      if (Math.abs(partner.restAngle - entry.restAngle) > POSE_EPSILON) {
        continue;
      }
      if (nowMs - motion.startMs >= motion.durationMs) continue;
      entry.motion.startMs = motion.startMs;
      entry.motion.durationMs = motion.durationMs;
      entry.motion.fromAngle = motion.fromAngle;
      entry.motion.fromOffset.copy(motion.fromOffset);
      return;
    }
  }

  /** The pose the voxel visibly has at `nowMs`; `progress` is 1 at rest. */
  private poseAt(
    entry: AnimatedVoxel,
    nowMs: number,
  ): { angle: number; offset: Vector3; progress: number } {
    const { motion } = entry;
    if (!motion) {
      return {
        angle: entry.restAngle,
        offset: scratchOffset.copy(entry.restOffset),
        progress: 1,
      };
    }
    const t = Math.min(
      Math.max((nowMs - motion.startMs) / motion.durationMs, 0),
      1,
    );
    const eased = (entry.animation.easing ?? easeOutCubic)(t);
    return {
      angle: motion.fromAngle + (entry.restAngle - motion.fromAngle) * eased,
      offset: scratchOffset
        .copy(motion.fromOffset)
        .lerp(entry.restOffset, eased),
      progress: t,
    };
  }

  /**
   * Write the voxel's current pose into its mesh. Returns whether the motion
   * has run its course.
   */
  private applyPoseAt(entry: AnimatedVoxel, nowMs: number): boolean {
    const { angle, offset, progress } = this.poseAt(entry, nowMs);
    const { mesh } = entry;

    const deltaAngle = angle - entry.restAngle;
    scratchTranslation.copy(offset).sub(entry.restOffset);

    if (
      Math.abs(deltaAngle) < POSE_EPSILON &&
      scratchTranslation.lengthSq() < POSE_EPSILON * POSE_EPSILON
    ) {
      mesh.matrix.copy(entry.rest);
    } else {
      // Turn about the hinge, then displace: T(p + d) · R · T(-p) · rest.
      scratchQuaternion.setFromAxisAngle(entry.axisWorld, deltaAngle);
      scratchRotation.makeRotationFromQuaternion(scratchQuaternion);
      scratchUnpivot.makeTranslation(
        -entry.pivotWorld.x,
        -entry.pivotWorld.y,
        -entry.pivotWorld.z,
      );
      scratchMatrix
        .makeTranslation(
          entry.pivotWorld.x + scratchTranslation.x,
          entry.pivotWorld.y + scratchTranslation.y,
          entry.pivotWorld.z + scratchTranslation.z,
        )
        .multiply(scratchRotation)
        .multiply(scratchUnpivot)
        .multiply(entry.rest);
      mesh.matrix.copy(scratchMatrix);
    }

    // Chunk meshes live under a group that skips its subtree's matrix walk
    // (nothing in a chunk moves — except this), so the world matrix has to
    // be composed by hand.
    mesh.updateMatrixWorld(true);
    return progress >= 1;
  }
}
