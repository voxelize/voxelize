import type { HeadLookMotion } from "./angle-spring";
import { shortestYawDelta } from "./yaw";

export const MAX_HEAD_YAW = 0.78;
export const MAX_HEAD_PITCH = 0.52;
const HEAD_LOOK_LERP = 0.35;

export interface HeadLookResult {
  headYawDelta: number;
  headPitchDelta: number;
  smoothedHeadYaw: number;
  smoothedHeadPitch: number;
}

export function computeHeadLook(
  headLookTarget: [number, number, number] | undefined,
  entityX: number,
  entityY: number,
  entityZ: number,
  currentBodyDirectionY: number,
  newDirectionY: number,
  smoothedHeadYaw: number,
  smoothedHeadPitch: number,
  /** The head's springs: an eased turn on real time. Without it the head
   *  closes a fixed share of the gap every frame, which snaps. */
  motion?: HeadLookMotion,
): HeadLookResult {
  let targetYaw: number;
  let targetPitch = 0;

  if (headLookTarget) {
    const dx = headLookTarget[0] - entityX;
    const dy = headLookTarget[1] - entityY;
    const dz = headLookTarget[2] - entityZ;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    targetYaw = Math.atan2(dx, dz);
    targetPitch = -Math.atan2(dy, horizontalDist);
  } else {
    targetYaw = newDirectionY;
  }

  const nextSmoothedYaw = motion
    ? motion.yaw.step(smoothedHeadYaw, targetYaw)
    : smoothedHeadYaw +
      shortestYawDelta(smoothedHeadYaw, targetYaw) * HEAD_LOOK_LERP;

  const freeYawDelta = shortestYawDelta(currentBodyDirectionY, nextSmoothedYaw);
  const headYawDelta = Math.max(
    -MAX_HEAD_YAW,
    Math.min(MAX_HEAD_YAW, freeYawDelta),
  );
  // Held at the neck's limit, the turn stops there instead of winding up.
  if (motion && headYawDelta !== freeYawDelta) motion.yaw.stop();

  const freePitch = motion
    ? motion.pitch.step(smoothedHeadPitch, targetPitch)
    : smoothedHeadPitch + (targetPitch - smoothedHeadPitch) * HEAD_LOOK_LERP;
  const nextSmoothedPitch = Math.max(
    -MAX_HEAD_PITCH,
    Math.min(MAX_HEAD_PITCH, freePitch),
  );
  if (motion && nextSmoothedPitch !== freePitch) motion.pitch.stop();

  return {
    headYawDelta,
    headPitchDelta: nextSmoothedPitch,
    smoothedHeadYaw: currentBodyDirectionY + headYawDelta,
    smoothedHeadPitch: nextSmoothedPitch,
  };
}
