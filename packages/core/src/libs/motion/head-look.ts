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

  const headYawDiff = shortestYawDelta(smoothedHeadYaw, targetYaw);
  const nextSmoothedYaw = smoothedHeadYaw + headYawDiff * HEAD_LOOK_LERP;

  let headYawDelta = shortestYawDelta(currentBodyDirectionY, nextSmoothedYaw);
  headYawDelta = Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, headYawDelta));

  const pitchDiff = targetPitch - smoothedHeadPitch;
  let nextSmoothedPitch = smoothedHeadPitch + pitchDiff * HEAD_LOOK_LERP;
  nextSmoothedPitch = Math.max(
    -MAX_HEAD_PITCH,
    Math.min(MAX_HEAD_PITCH, nextSmoothedPitch),
  );

  return {
    headYawDelta,
    headPitchDelta: nextSmoothedPitch,
    smoothedHeadYaw: currentBodyDirectionY + headYawDelta,
    smoothedHeadPitch: nextSmoothedPitch,
  };
}
