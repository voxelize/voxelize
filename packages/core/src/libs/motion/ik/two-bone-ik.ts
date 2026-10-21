import * as THREE from "three";

export interface TwoBoneIkLimb {
  upperLength: number;
  lowerLength: number;
  minBendAngle: number;
  maxBendAngle: number;
  // Fraction of max reach where soft IK engages: past it, the remaining
  // target distance is compressed asymptotically so the joint always keeps
  // residual bend and extension never pops. 1 disables softening.
  softStartRatio: number;
}

const toTarget = new THREE.Vector3();
const bendDir = new THREE.Vector3();
const axis = new THREE.Vector3();

export function solveTwoBoneIk(
  root: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  limb: TwoBoneIkLimb,
  outMid: THREE.Vector3,
  outEnd: THREE.Vector3,
): void {
  // Analytic two-bone solve in whatever space the inputs share. The pole
  // direction picks the bend plane; the joint (knee/elbow) always bends
  // toward it. Bend limits are expressed as the interior angle between the
  // two segments (PI = fully straight) and are enforced by clamping the
  // reachable distance, which keeps the solve branch-free.
  const { upperLength, lowerLength } = limb;

  toTarget.subVectors(target, root);
  let distance = toTarget.length();
  if (distance < 1e-6) {
    toTarget.copy(pole);
    distance = 1e-6;
  }
  axis.copy(toTarget).multiplyScalar(1 / distance);

  const minReach = distanceForBendAngle(limb, limb.minBendAngle);
  const maxReach = distanceForBendAngle(limb, limb.maxBendAngle);
  const reach = Math.min(
    Math.max(softenReach(distance, maxReach, limb.softStartRatio), minReach),
    maxReach,
  );

  outEnd.copy(root).addScaledVector(axis, reach);

  bendDir.copy(pole).addScaledVector(axis, -pole.dot(axis));
  if (bendDir.lengthSq() < 1e-8) {
    // Pole is parallel to the root-target axis; any perpendicular works.
    bendDir.set(-axis.y, axis.x, 0);
    if (bendDir.lengthSq() < 1e-8) bendDir.set(0, -axis.z, axis.y);
  }
  bendDir.normalize();

  // Law of cosines: distance from root along the axis to the joint's
  // perpendicular foot, then the perpendicular height of the joint.
  const along =
    (upperLength * upperLength - lowerLength * lowerLength + reach * reach) /
    (2 * reach);
  const heightSq = upperLength * upperLength - along * along;
  const height = heightSq > 0 ? Math.sqrt(heightSq) : 0;

  outMid
    .copy(root)
    .addScaledVector(axis, along)
    .addScaledVector(bendDir, height);
}

export function softenReach(
  distance: number,
  maxReach: number,
  softStartRatio: number,
): number {
  // Exponential soft clamp: identity below the soft start, then the
  // remaining distance compresses with an asymptote at maxReach. C1 at the
  // knee point (derivative 1), so extension eases instead of popping.
  const softStart = softStartRatio * maxReach;
  if (distance <= softStart) return distance;
  const range = maxReach - softStart;
  if (range <= 1e-6) return distance;
  return softStart + range * (1 - Math.exp(-(distance - softStart) / range));
}

function distanceForBendAngle(limb: TwoBoneIkLimb, bendAngle: number): number {
  const cos = Math.cos(bendAngle);
  return Math.sqrt(
    Math.max(
      1e-8,
      limb.upperLength * limb.upperLength +
        limb.lowerLength * limb.lowerLength -
        2 * limb.upperLength * limb.lowerLength * cos,
    ),
  );
}
