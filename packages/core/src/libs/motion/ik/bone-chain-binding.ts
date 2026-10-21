import * as THREE from "three";

// Bridges IK joint positions to the flat-bone instanced skinning shader
// (out = pivot + M * (v - pivot), no parent inheritance). Each segment's
// geometry must be built with its pivotOffset at the segment's rest base
// joint; the emitted matrix is then T(currentBase - restBase) * R where R
// carries the rest direction onto the current direction.
export interface ChainBinding {
  boneIndices: readonly number[];
  restJoints: readonly THREE.Vector3[];
  restDirections: readonly THREE.Vector3[];
}

export function createChainBinding(
  boneIndices: readonly number[],
  restJoints: readonly THREE.Vector3[],
): ChainBinding {
  const restDirections: THREE.Vector3[] = [];
  for (let i = 0; i < boneIndices.length; i++) {
    restDirections.push(
      new THREE.Vector3()
        .subVectors(restJoints[i + 1], restJoints[i])
        .normalize(),
    );
  }
  return { boneIndices, restJoints, restDirections };
}

const currentDir = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const matrix = new THREE.Matrix4();

export type BoneMatrixWriter = (
  boneIndex: number,
  boneMatrix: THREE.Matrix4,
) => void;

export function writeChainBones(
  binding: ChainBinding,
  joints: readonly THREE.Vector3[],
  writeBone: BoneMatrixWriter,
): void {
  for (let i = 0; i < binding.boneIndices.length; i++) {
    currentDir.subVectors(joints[i + 1], joints[i]);
    const length = currentDir.length();
    if (length < 1e-8) {
      currentDir.copy(binding.restDirections[i]);
    } else {
      currentDir.multiplyScalar(1 / length);
    }

    rotation.setFromUnitVectors(binding.restDirections[i], currentDir);
    matrix.makeRotationFromQuaternion(rotation);
    matrix.setPosition(
      joints[i].x - binding.restJoints[i].x,
      joints[i].y - binding.restJoints[i].y,
      joints[i].z - binding.restJoints[i].z,
    );
    writeBone(binding.boneIndices[i], matrix);
  }
}
