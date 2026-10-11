/**
 * The pin as plain data: a point on the terrain, what the source knows
 * about the column under it, and the arithmetic the pin actions share
 * (measuring from the pin to another point, the pose a player would stand
 * in at it, the compact form a URL carries).
 */
import type { Pose, Vec3 } from "./pose";

export type PinFact = { label: string; value: string };

export type Pin = {
  /** The ground point: x and z where it was dropped, y the top face there. */
  point: Vec3;
  /** What the source reported for the column, once it answered. */
  facts: PinFact[];
};

export type Measurement = {
  /** Straight-line distance, blocks. */
  distance: number;
  /** Distance over the ground plane, blocks. */
  horizontal: number;
  /** Height of `to` over `from`, blocks (negative going down). */
  rise: number;
  /** Rise over run, percent; null when the two share a column. */
  slopePercent: number | null;
  /** The same slope as an angle from level, degrees. */
  slopeDegrees: number;
};

export function measure(from: Vec3, to: Vec3): Measurement {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const rise = to[1] - from[1];
  const horizontal = Math.hypot(dx, dz);
  return {
    distance: Math.hypot(horizontal, rise),
    horizontal,
    rise,
    slopePercent: horizontal > 1e-9 ? (rise / horizontal) * 100 : null,
    slopeDegrees: (Math.atan2(rise, horizontal) * 180) / Math.PI,
  };
}

/**
 * Where a player would stand at `point`, eyes `eyeHeight` over the top face
 * of the column (the block's centre), looking level along `yaw` (the
 * camera's heading: 0 looks toward -z, as the orbit rig's yaw does).
 */
export function standingPose(
  point: Vec3,
  yaw: number,
  eyeHeight: number,
): Pose {
  const eye: Vec3 = [
    Math.floor(point[0]) + 0.5,
    point[1] + eyeHeight,
    Math.floor(point[2]) + 0.5,
  ];
  return {
    eye,
    look: [eye[0] - Math.sin(yaw) * 8, eye[1], eye[2] - Math.cos(yaw) * 8],
  };
}

/** `x y z` of the block column, the form a chat command takes. */
export function formatCoordinates(point: Vec3): string {
  return `${Math.floor(point[0])} ${Math.round(point[1])} ${Math.floor(point[2])}`;
}

const number = (v: number) => String(Number(v.toFixed(1)));

/** The pin's point as `x,y,z`, the `pin` URL parameter. */
export function serializePin(point: Vec3): string {
  return point.map(number).join(",");
}

function parsePoint(text: string, param: string): Vec3 {
  const coords = text.split(",").map(Number);
  if (coords.length !== 3 || coords.some((n) => !Number.isFinite(n))) {
    throw new Error(`expected x,y,z in ${param}, got ${JSON.stringify(text)}`);
  }
  return coords as Vec3;
}

/**
 * The pin a URL carries: `pin=x,y,z`, or the first entry of an older
 * link's `pins=label:x,y,z;...`; null when it carries none. Refuses
 * anything it cannot read.
 */
export function pinFromUrl(search: string): Vec3 | null {
  const params = new URLSearchParams(search);
  const single = params.get("pin");
  if (single?.trim()) return parsePoint(single, "pin");
  const first = params.get("pins")?.split(";")[0];
  if (!first?.trim()) return null;
  return parsePoint(first.slice(first.lastIndexOf(":") + 1), "pins");
}
