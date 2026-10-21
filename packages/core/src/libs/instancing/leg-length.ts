import type * as THREE from "three";

/// Fraction of the mesh height above its lowest vertex still counted as the
/// soles: the box feet of every walker end on one flat face.
const SOLE_BAND = 0.02;

/// Hip-to-sole length of the legs as a baked skinned mesh actually draws
/// them, in mesh units (size 1). Every box builder hangs each leg from a
/// pivot at the body's underside and skins the whole leg to one bone, so the
/// bones whose vertices touch the ground are the legs, each one's hip is its
/// topmost pivot and its sole its lowest vertex. The stride clock paces the
/// legs from this number (times the instance size) instead of a render-scale
/// guess, so a variant's longer legs and a baby's stubby ones both reach the
/// footfalls. Returns null when the geometry lacks the shared skinning
/// attributes, so a family whose mesh changes shape degrades to the
/// render-scale fallback rather than to a wrong stride.
export function measureLegLength(
  geometry: THREE.BufferGeometry,
): number | null {
  const position = geometry.getAttribute("position");
  const pivot = geometry.getAttribute("pivotOffset");
  const skin = geometry.getAttribute("skinIndex");
  if (!position || !pivot || !skin || position.count === 0) return null;

  const count = position.count;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < count; v++) {
    const y = position.getY(v);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  if (!(height > 0)) return null;

  const soleTop = minY + height * SOLE_BAND;
  const legBones = new Set<number>();
  for (let v = 0; v < count; v++) {
    if (position.getY(v) <= soleTop) legBones.add(Math.round(skin.getX(v)));
  }
  if (legBones.size === 0) return null;

  const hip = new Map<number, number>();
  const sole = new Map<number, number>();
  for (let v = 0; v < count; v++) {
    const bone = Math.round(skin.getX(v));
    if (!legBones.has(bone)) continue;
    hip.set(bone, Math.max(hip.get(bone) ?? -Infinity, pivot.getY(v)));
    sole.set(bone, Math.min(sole.get(bone) ?? Infinity, position.getY(v)));
  }

  const lengths: number[] = [];
  for (const bone of legBones) {
    const length = (hip.get(bone) ?? 0) - (sole.get(bone) ?? 0);
    if (length > 0) lengths.push(length);
  }
  if (lengths.length === 0) return null;
  // The median: a part that happens to rest on the ground beside the feet
  // cannot drag the leg length with it.
  lengths.sort((a, b) => a - b);
  const mid = lengths.length >> 1;
  return lengths.length % 2 === 1
    ? lengths[mid]
    : (lengths[mid - 1] + lengths[mid]) * 0.5;
}
