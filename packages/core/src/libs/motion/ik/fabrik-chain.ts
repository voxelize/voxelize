import * as THREE from "three";

import { softenReach } from "./two-bone-ik";

export interface FabrikSolveOptions {
  iterations: number;
  tolerance: number;
  maxBendAngle: number;
  baseDirection: THREE.Vector3 | null;
  baseMaxAngle: number;
  // Fraction of total chain length where end-reach softening engages; the
  // effective target compresses asymptotically so the chain keeps residual
  // curve instead of snapping dead straight. 1 disables softening.
  softStartRatio: number;
}

// FABRIK chosen over CCD: it distributes curvature evenly along the chain
// (organic tentacle/limb curves instead of CCD's end-heavy curl), operates
// directly on preallocated joint positions with no rotational bookkeeping,
// and degrades gracefully to a straight reach when targets are out of range.

export class IkChain {
  readonly joints: THREE.Vector3[];
  readonly segmentLengths: number[];
  readonly totalLength: number;

  constructor(segmentLengths: number[]) {
    this.segmentLengths = segmentLengths.slice();
    this.totalLength = segmentLengths.reduce((sum, len) => sum + len, 0);
    this.joints = [];
    for (let i = 0; i <= segmentLengths.length; i++) {
      this.joints.push(new THREE.Vector3());
    }
  }

  setFromJointPositions(positions: readonly THREE.Vector3[]): void {
    for (let i = 0; i < this.joints.length; i++) {
      this.joints[i].copy(positions[i]);
    }
  }
}

const segmentDir = new THREE.Vector3();
const prevDir = new THREE.Vector3();
const coneAxis = new THREE.Vector3();
const conePerp = new THREE.Vector3();
const softTarget = new THREE.Vector3();

function clampDirectionToCone(
  dir: THREE.Vector3,
  axis: THREE.Vector3,
  maxAngle: number,
): void {
  const cosAngle = dir.dot(axis);
  const cosMax = Math.cos(maxAngle);
  if (cosAngle >= cosMax) return;

  conePerp.copy(dir).addScaledVector(axis, -cosAngle);
  if (conePerp.lengthSq() < 1e-10) {
    conePerp.set(-axis.y, axis.x, 0);
    if (conePerp.lengthSq() < 1e-10) conePerp.set(0, -axis.z, axis.y);
  }
  conePerp.normalize();

  dir
    .copy(axis)
    .multiplyScalar(cosMax)
    .addScaledVector(conePerp, Math.sin(maxAngle));
}

export function solveFabrik(
  chain: IkChain,
  base: THREE.Vector3,
  target: THREE.Vector3,
  options: FabrikSolveOptions,
): void {
  const { joints, segmentLengths } = chain;
  const jointCount = joints.length;
  const tipIndex = jointCount - 1;
  const toleranceSq = options.tolerance * options.tolerance;

  softTarget.subVectors(target, base);
  const targetDistance = softTarget.length();
  const softenedDistance = softenReach(
    targetDistance,
    chain.totalLength,
    options.softStartRatio,
  );
  if (softenedDistance < targetDistance && targetDistance > 1e-6) {
    softTarget.multiplyScalar(softenedDistance / targetDistance).add(base);
  } else {
    softTarget.copy(target);
  }

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    joints[tipIndex].copy(softTarget);
    for (let j = tipIndex - 1; j >= 0; j--) {
      segmentDir.subVectors(joints[j], joints[j + 1]);
      const length = segmentDir.length();
      if (length < 1e-8) {
        segmentDir.set(0, 1, 0);
      } else {
        segmentDir.multiplyScalar(1 / length);
      }
      joints[j]
        .copy(joints[j + 1])
        .addScaledVector(segmentDir, segmentLengths[j]);
    }

    joints[0].copy(base);
    for (let j = 1; j < jointCount; j++) {
      segmentDir.subVectors(joints[j], joints[j - 1]);
      const length = segmentDir.length();
      if (length < 1e-8) {
        segmentDir.set(0, -1, 0);
      } else {
        segmentDir.multiplyScalar(1 / length);
      }

      if (j === 1) {
        if (options.baseDirection) {
          coneAxis.copy(options.baseDirection);
          clampDirectionToCone(segmentDir, coneAxis, options.baseMaxAngle);
        }
      } else {
        prevDir.subVectors(joints[j - 1], joints[j - 2]).normalize();
        clampDirectionToCone(segmentDir, prevDir, options.maxBendAngle);
      }

      joints[j]
        .copy(joints[j - 1])
        .addScaledVector(segmentDir, segmentLengths[j - 1]);
    }

    if (joints[tipIndex].distanceToSquared(softTarget) < toleranceSq) break;
  }
}
