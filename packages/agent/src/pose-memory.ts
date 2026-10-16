/**
 * The agent's last pose, and when to put it back.
 *
 * A page that rejoins (a reload, a page reset after a server restart, an
 * in-page reconnect) comes back wherever the server spawns it, and the
 * staging a capture depended on is gone. The daemon samples the live pose
 * while the world is fresh and, the first time it sees a new join, puts the
 * last one back. A join is new when the page document changed, the host
 * installed a new bridge in the same page (a world switched in place), the
 * client's join generation moved, or the world changed, so even a reload
 * fast enough to never look stale is caught. A pose is only ever put back
 * in the world it was taken in: a join in another world keeps wherever that
 * world placed the agent.
 *
 * Position and facing are read from the page; flying and the view radius
 * cannot be, so they are remembered from the commands that set them.
 */

export const RESTORE_POSE_ENV = "AGENT_RESTORE_POSE";

export type PoseVec3 = { x: number; y: number; z: number };

export type JoinIdentity = {
  /** `performance.timeOrigin` of the page document. */
  documentId: number | null;
  /**
   * Which bridge in the document (`Snapshot.joinSerial`): a world switched
   * in place keeps the document and starts a fresh network, whose join
   * generation starts over, so only this tells its join from the last one.
   * Null on hosts that do not report it.
   */
  joinSerial: number | null;
  joinGeneration: number | null;
  /** `Snapshot.world`; null when the host does not say. */
  world: string | null;
};

export type PoseSample = {
  position: PoseVec3;
  facing: { yaw: number; pitch: number };
  documentId: number | null;
  /** Read in the same page call as the position, when the host reports them. */
  joinSerial?: number | null;
  joinGeneration?: number | null;
  world?: string | null;
};

export type PoseIntent = {
  isFlying: boolean | null;
  renderRadius: number | null;
};

export type RememberedPose = PoseIntent & {
  position: PoseVec3;
  facing: { yaw: number; pitch: number };
  sampledAt: number;
  join: JoinIdentity;
};

export type PoseRestoreRecord = {
  at: number;
  pose: RememberedPose;
  from: JoinIdentity;
  to: JoinIdentity;
  /** Null when it landed; otherwise why it did not. */
  error: string | null;
};

export function resolvePoseRestore(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env[RESTORE_POSE_ENV] ?? "").trim() !== "0";
}

export const EMPTY_POSE_INTENT: PoseIntent = {
  isFlying: null,
  renderRadius: null,
};

function isWorldChanged(from: JoinIdentity, to: JoinIdentity): boolean {
  return from.world !== null && to.world !== null && from.world !== to.world;
}

export function isNewJoin(
  pose: RememberedPose,
  current: JoinIdentity,
): boolean {
  return (
    pose.join.documentId !== current.documentId ||
    pose.join.joinSerial !== current.joinSerial ||
    pose.join.joinGeneration !== current.joinGeneration ||
    isWorldChanged(pose.join, current)
  );
}

/**
 * The page names another world while the same bridge still answers: a world
 * switch in place has started (the address changed first) and the old
 * world's bridge has not been taken down yet. Its pose belongs to neither
 * join, so it is neither remembered nor put back.
 */
export function isMidWorldSwitch(
  pose: RememberedPose,
  current: JoinIdentity,
): boolean {
  return (
    pose.join.documentId === current.documentId &&
    pose.join.joinSerial === current.joinSerial &&
    pose.join.joinGeneration === current.joinGeneration &&
    isWorldChanged(pose.join, current)
  );
}

/**
 * Why a remembered pose must not be put back on the join `to`, or null when
 * it may be: a pose taken in one world means nothing in another.
 */
export function poseRestoreSkipReason(
  pose: RememberedPose,
  to: JoinIdentity,
): string | null {
  if (!isWorldChanged(pose.join, to)) return null;
  return `world changed ${pose.join.world}->${to.world}; not restoring the pose`;
}

/**
 * The flying and view-radius intent to keep across the join `from -> to`:
 * all of it within one world, none into another. Those were asked of the
 * world being left; the new one starts as its page sets it up, and a later
 * rejoin there must not replay them.
 */
export function carriedPoseIntent(
  intent: PoseIntent,
  from: JoinIdentity,
  to: JoinIdentity,
): PoseIntent {
  return isWorldChanged(from, to) ? EMPTY_POSE_INTENT : intent;
}

/** `from -> to` for the log: what moved between two joins. */
export function describeJoinChange(
  from: JoinIdentity,
  to: JoinIdentity,
): string {
  const parts = [
    `join generation ${from.joinGeneration} -> ${to.joinGeneration}`,
  ];
  if (from.documentId !== to.documentId) parts.push("new page document");
  else if (from.joinSerial !== to.joinSerial) {
    parts.push(
      `bridge ${from.joinSerial} -> ${to.joinSerial} in the same page`,
    );
  }
  if (isWorldChanged(from, to))
    parts.push(`world ${from.world} -> ${to.world}`);
  return parts.join(", ");
}

export function rememberPose(
  sample: PoseSample,
  join: JoinIdentity,
  intent: PoseIntent,
  now: number,
): RememberedPose {
  return {
    position: { ...sample.position },
    facing: { yaw: sample.facing.yaw, pitch: sample.facing.pitch },
    isFlying: intent.isFlying,
    renderRadius: intent.renderRadius,
    sampledAt: now,
    join: { ...join },
  };
}

/**
 * Whether a command moved the agent after `pose` was remembered, or is moving
 * it now. Putting such a pose back undoes the newer command: a teleport still
 * in flight when the rejoin is noticed has to stand. `lastMoveCommandAt` is
 * when the latest moving command started.
 */
export function isPoseSuperseded(
  pose: RememberedPose,
  lastMoveCommandAt: number,
  moveCommandsInFlight: number,
): boolean {
  return moveCommandsInFlight > 0 || lastMoveCommandAt > pose.sampledAt;
}

export function mergePoseIntent(
  intent: PoseIntent,
  patch: Partial<PoseIntent>,
): PoseIntent {
  return {
    isFlying: patch.isFlying !== undefined ? patch.isFlying : intent.isFlying,
    renderRadius:
      patch.renderRadius !== undefined
        ? patch.renderRadius
        : intent.renderRadius,
  };
}

function degrees(radians: number): string {
  return `${Math.round((radians * 180) / Math.PI)}°`;
}

export function describePose(pose: RememberedPose): string {
  const { x, y, z } = pose.position;
  const parts = [
    `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
    `yaw ${degrees(pose.facing.yaw)} pitch ${degrees(pose.facing.pitch)}`,
  ];
  if (pose.isFlying !== null) parts.push(pose.isFlying ? "flying" : "walking");
  if (pose.renderRadius !== null)
    parts.push(`view radius ${pose.renderRadius}`);
  return parts.join(", ");
}

/** Largest positional and angular difference, for "did it land" checks. */
export function poseError(
  pose: RememberedPose,
  sample: PoseSample,
): { distance: number; yaw: number; pitch: number } {
  const dx = pose.position.x - sample.position.x;
  const dy = pose.position.y - sample.position.y;
  const dz = pose.position.z - sample.position.z;
  const wrap = (angle: number) =>
    Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
  return {
    distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
    yaw: wrap(pose.facing.yaw - sample.facing.yaw),
    pitch: wrap(pose.facing.pitch - sample.facing.pitch),
  };
}
