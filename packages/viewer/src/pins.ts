/**
 * Pins as plain data: a labelled point on the terrain, what the source
 * knows about the column under it, and the arithmetic the pin actions
 * share (measuring between two pins, the pose a player would stand in at
 * one, the compact form a URL carries).
 */
import type { Pose, Vec3 } from "./pose";

export type PinFact = { label: string; value: string };

export type Pin = {
  id: string;
  /** Short name shown on the pin's banner and tag: A, B, ... unless renamed. */
  label: string;
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

/** A, B, ... Z, then AA, AB: the n-th pin's default label (0-based). */
export function pinLabel(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** The first default label no current pin uses. */
export function nextPinLabel(pins: readonly Pin[]): string {
  const used = new Set(pins.map((p) => p.label));
  for (let i = 0; ; i++) {
    const label = pinLabel(i);
    if (!used.has(label)) return label;
  }
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

/** Pins as `label:x,y,z` joined by `;`, for a URL parameter. */
export function serializePins(pins: readonly Pin[]): string {
  return pins
    .map(
      (p) => `${encodeURIComponent(p.label)}:${p.point.map(number).join(",")}`,
    )
    .join(";");
}

/** The inverse of `serializePins`; refuses anything it cannot read. */
export function parsePins(text: string): { label: string; point: Vec3 }[] {
  if (!text.trim()) return [];
  return text.split(";").map((part) => {
    const at = part.lastIndexOf(":");
    const coords = part
      .slice(at + 1)
      .split(",")
      .map(Number);
    if (
      at <= 0 ||
      coords.length !== 3 ||
      coords.some((n) => !Number.isFinite(n))
    ) {
      throw new Error(
        `expected label:x,y,z in pins, got ${JSON.stringify(part)}`,
      );
    }
    return {
      label: decodeURIComponent(part.slice(0, at)),
      point: coords as Vec3,
    };
  });
}
