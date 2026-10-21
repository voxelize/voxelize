import * as THREE from "three";

// Mirrors the incrementLightingFrame pattern: the render loop publishes the
// camera position once per frame and entities query it during their update.
const cameraPosition = new THREE.Vector3();
let isCameraPositionKnown = false;

export function setIkCameraPosition(position: THREE.Vector3): void {
  cameraPosition.copy(position);
  isCameraPositionKnown = true;
}

/** A world left: no camera until the next world's first frame. */
export function resetIkCameraPosition(): void {
  isCameraPositionKnown = false;
}

export function isWithinIkRange(
  position: THREE.Vector3,
  range: number,
): boolean {
  if (!isCameraPositionKnown) return false;
  return cameraPosition.distanceToSquared(position) < range * range;
}
