/**
 * The agent's last pose, and when to put it back.
 *
 * A page that rejoins (a reload, a page reset after a server restart, an
 * in-page reconnect) comes back wherever the server spawns it, and the
 * staging a capture depended on is gone. The daemon samples the live pose
 * while the world is fresh and, the first time it sees a new join, puts the
 * last one back. A join is new when the page document changed or the
 * client's join generation moved, so even a reload fast enough to never
 * look stale is caught.
 *
 * Position and facing are read from the page; flying and the view radius
 * cannot be, so they are remembered from the commands that set them.
 */

export const RESTORE_POSE_ENV = "AGENT_RESTORE_POSE";

export type PoseVec3 = { x: number; y: number; z: number };

export type JoinIdentity = {
  /** `performance.timeOrigin` of the page document. */
  documentId: number | null;
  joinGeneration: number | null;
};

export type PoseSample = {
  position: PoseVec3;
  facing: { yaw: number; pitch: number };
  documentId: number | null;
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

export function isNewJoin(
  pose: RememberedPose,
  current: JoinIdentity,
): boolean {
  return (
    pose.join.documentId !== current.documentId ||
    pose.join.joinGeneration !== current.joinGeneration
  );
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
