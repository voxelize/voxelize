import type * as THREE from "three/webgpu";

/// How far a baked skinned mesh's farthest rest-pose vertex stands from the
/// entity origin, in mesh units (size 1): a wing tip, a fluke, the end of a
/// tail. A sphere of this radius about the origin holds the body however it
/// is turned, so it bounds what an instance draws for the off-screen test:
/// a whale's flukes are still posed every frame while only they are in
/// view. 0 for an empty mesh.
export function measureMeshReach(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute("position");
  if (!position || position.count === 0) return 0;
  let farthestSq = 0;
  for (let v = 0; v < position.count; v++) {
    const x = position.getX(v);
    const y = position.getY(v);
    const z = position.getZ(v);
    const distanceSq = x * x + y * y + z * z;
    if (distanceSq > farthestSq) farthestSq = distanceSq;
  }
  return Math.sqrt(farthestSq);
}
