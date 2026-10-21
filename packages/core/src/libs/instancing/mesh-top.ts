import type * as THREE from "three";

/// Height of a baked skinned mesh's tallest rest-pose vertex above the
/// entity origin, in mesh units (size 1): the crown, a hat's tip or a
/// carried lamp, whichever stands highest. A name floats a fixed gap over
/// it instead of over a render-scale guess, so a round cap and a pointed
/// hat both wear their name just overhead. Null for an empty mesh.
export function measureMeshTop(geometry: THREE.BufferGeometry): number | null {
  const position = geometry.getAttribute("position");
  if (!position || position.count === 0) return null;
  let top = -Infinity;
  for (let v = 0; v < position.count; v++) {
    const y = position.getY(v);
    if (y > top) top = y;
  }
  return top;
}
