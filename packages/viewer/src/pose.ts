/**
 * Camera poses as plain data: what a share link, a bookmark, a capture
 * request and the control API all speak. A pose is an eye and the point it
 * looks at, the same two vectors a game's own share link carries; the rigs
 * convert it to and from their own state.
 */

export type Vec3 = [number, number, number];

export type Pose = { eye: Vec3; look: Vec3 };

/** How the camera is set up: a point orbited from a distance, or flown. */
export type Projection = "perspective" | "orthographic";

export type Preset = "free" | "orbit" | "top" | "iso";

export const PRESETS: readonly Preset[] = ["free", "orbit", "top", "iso"];

/** True isometric pitch: the camera looks down the cube's diagonal. */
export const ISO_PITCH = Math.atan(1 / Math.SQRT2);

/** A pose from straight above is never exactly vertical (no defined yaw). */
export const TOP_PITCH = Math.PI / 2 - 1e-3;

export type Orbit = {
  target: Vec3;
  distance: number;
  /** Azimuth of the eye around the target, radians; 0 puts it at +z. */
  yaw: number;
  /** Elevation of the eye over the target, radians; positive is above. */
  pitch: number;
};

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function orbitEye(orbit: Orbit): Vec3 {
  const { target, distance, yaw, pitch } = orbit;
  const c = Math.cos(pitch);
  return [
    target[0] + distance * c * Math.sin(yaw),
    target[1] + distance * Math.sin(pitch),
    target[2] + distance * c * Math.cos(yaw),
  ];
}

export function poseFromOrbit(orbit: Orbit): Pose {
  return { eye: orbitEye(orbit), look: [...orbit.target] as Vec3 };
}

export function orbitFromPose(pose: Pose): Orbit {
  const d = sub(pose.eye, pose.look);
  const distance = Math.max(length(d), 1e-3);
  const pitch = Math.asin(Math.max(-1, Math.min(1, d[1] / distance)));
  const yaw = Math.atan2(d[0], d[2]);
  return { target: [...pose.look] as Vec3, distance, yaw, pitch };
}

/** Unit view direction of a pose (eye toward look). */
export function forward(pose: Pose): Vec3 {
  const d = sub(pose.look, pose.eye);
  const l = Math.max(length(d), 1e-9);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/**
 * The orbit a preset starts from around `target`, framing roughly `span`
 * blocks. `yaw` is kept for presets that do not fix it, so switching from
 * free to iso keeps the side the camera was on.
 */
export function presetOrbit(
  preset: Preset,
  target: Vec3,
  span: number,
  yaw = Math.PI / 4,
): Orbit {
  switch (preset) {
    case "top":
      return { target, distance: span * 1.2, yaw: 0, pitch: TOP_PITCH };
    case "iso": {
      // Snap to the nearest diagonal so the grid reads as a diamond.
      const quarter = Math.PI / 2;
      const snapped =
        Math.round((yaw - Math.PI / 4) / quarter) * quarter + Math.PI / 4;
      return { target, distance: span * 1.4, yaw: snapped, pitch: ISO_PITCH };
    }
    case "orbit":
      return { target, distance: span, yaw, pitch: 0.6 };
    case "free":
    default:
      return { target, distance: span * 0.5, yaw, pitch: 0.35 };
  }
}

export function presetProjection(preset: Preset): Projection {
  return preset === "top" || preset === "iso" ? "orthographic" : "perspective";
}

/** `x,y,z` with up to `digits` decimals, trailing zeros dropped. */
export function formatVec(v: Vec3, digits = 1): string {
  return v
    .map((n) => {
      const r = Number(n.toFixed(digits));
      return Object.is(r, -0) ? "0" : String(r);
    })
    .join(",");
}

export function parseVec(text: string): Vec3 {
  const parts = text.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`expected x,y,z, got ${JSON.stringify(text)}`);
  }
  return parts as Vec3;
}

/**
 * A pose a perspective game camera can stand at for what an orthographic
 * view shows: `back` blocks behind the look point along the view direction.
 * An iso or top-down frame has no eye of its own, and a share link needs
 * one.
 */
export function standInPose(pose: Pose, back = 48): Pose {
  const f = forward(pose);
  return {
    eye: [
      pose.look[0] - f[0] * back,
      pose.look[1] - f[1] * back,
      pose.look[2] - f[2] * back,
    ],
    look: pose.look,
  };
}

/** A named place to jump to, as plain data a host ships with its config. */
export type Bookmark = {
  id: string;
  label: string;
  /** The source world it belongs to; absent means any. */
  world?: string;
  pose: Pose;
  preset?: Preset;
  note?: string;
};

/**
 * Builds the link that opens a game at `pose` in `world`, or null when the
 * host has none. The engine knows no game's URL shape; the host supplies
 * this.
 */
export type ShareLinkFormatter = (
  pose: Pose,
  context: { world: string },
) => string | null;
