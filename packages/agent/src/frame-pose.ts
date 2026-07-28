import type { Vec3 } from "./bridge";

export type FramePreset = "portrait" | "side" | "three-quarter" | "top";

export const FRAME_PRESETS: FramePreset[] = [
  "portrait",
  "side",
  "three-quarter",
  "top",
];

export type FramePoseRequest = {
  position: Vec3;
  metadata: Record<string, unknown>;
  preset: FramePreset;
  /** Camera distance = subject extent * multiplier, clamped to the minimum. */
  distanceMultiplier?: number;
  /** Absolute camera distance override; wins over the multiplier. */
  distance?: number;
  /** Absolute azimuth in degrees (0 = +x, counterclockwise seen from above);
   * overrides the preset's facing-relative azimuth. Used by orbit shots. */
  azimuthDeg?: number;
};

export type FramePose = {
  from: Vec3;
  lookAt: Vec3;
  distance: number;
  azimuthDeg: number;
  elevationDeg: number;
  subjectExtent: number;
};

export const DEFAULT_FRAME_DISTANCE_MULTIPLIER = 2.5;
export const MIN_FRAME_DISTANCE = 2;
export const DEFAULT_SUBJECT_EXTENT = 1;

// Azimuth is measured relative to the subject's facing yaw: portrait shoots
// the face, side the profile, three-quarter the classic showcase angle.
const PRESET_RELATIVE_AZIMUTH_DEG: Record<FramePreset, number> = {
  portrait: 0,
  side: 90,
  "three-quarter": 45,
  top: 0,
};

// Top stays shy of 90 degrees so the look direction never degenerates
// against the camera up vector.
const PRESET_ELEVATION_DEG: Record<FramePreset, number> = {
  portrait: 10,
  side: 5,
  "three-quarter": 25,
  top: 80,
};

type AabbLike = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

function isAabbLike(value: unknown): value is AabbLike {
  if (value === null || typeof value !== "object") return false;
  const aabb = value as Record<string, unknown>;
  return ["minX", "minY", "minZ", "maxX", "maxY", "maxZ"].every(
    (key) => typeof aabb[key] === "number" && Number.isFinite(aabb[key]),
  );
}

/**
 * Largest dimension of the subject, in blocks, from the best evidence the
 * entity snapshot offers: a live AABB (server debug metadata), then a scalar
 * `size`, then the default. Never zero or negative.
 */
export function subjectExtent(metadata: Record<string, unknown>): number {
  const debug = metadata.debug;
  const aabb =
    debug !== null && typeof debug === "object"
      ? (debug as Record<string, unknown>).aabb
      : metadata.aabb;
  if (isAabbLike(aabb)) {
    const extent = Math.max(
      aabb.maxX - aabb.minX,
      aabb.maxY - aabb.minY,
      aabb.maxZ - aabb.minZ,
    );
    if (extent > 0) return extent;
  }
  const size = metadata.size;
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    return size;
  }
  return DEFAULT_SUBJECT_EXTENT;
}

/**
 * Horizontal facing yaw from the entity's replicated direction vector
 * (radians, atan2(z, x)); null when absent or degenerate.
 */
export function facingYawRad(metadata: Record<string, unknown>): number | null {
  const raw = metadata.direction;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const [x, , z] = raw;
  if (typeof x !== "number" || typeof z !== "number") return null;
  if (Math.hypot(x, z) < 1e-3) return null;
  return Math.atan2(z, x);
}

export function computeFramePose(request: FramePoseRequest): FramePose {
  const extent = subjectExtent(request.metadata);
  const multiplier =
    request.distanceMultiplier ?? DEFAULT_FRAME_DISTANCE_MULTIPLIER;
  const distance = Math.max(
    MIN_FRAME_DISTANCE,
    request.distance ?? extent * multiplier,
  );

  const facingYaw = facingYawRad(request.metadata) ?? 0;
  const azimuthRad =
    request.azimuthDeg !== undefined
      ? (request.azimuthDeg * Math.PI) / 180
      : facingYaw +
        (PRESET_RELATIVE_AZIMUTH_DEG[request.preset] * Math.PI) / 180;
  const elevationRad = (PRESET_ELEVATION_DEG[request.preset] * Math.PI) / 180;

  const lookAt = { ...request.position };
  const horizontal = Math.cos(elevationRad) * distance;
  const from: Vec3 = {
    x: lookAt.x + Math.cos(azimuthRad) * horizontal,
    y: lookAt.y + Math.sin(elevationRad) * distance,
    z: lookAt.z + Math.sin(azimuthRad) * horizontal,
  };

  return {
    from,
    lookAt,
    distance,
    azimuthDeg: (azimuthRad * 180) / Math.PI,
    elevationDeg: PRESET_ELEVATION_DEG[request.preset],
    subjectExtent: extent,
  };
}
