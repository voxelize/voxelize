import type { Vector3 } from "three";

// Per-entity smoothing state, keyed by the entity's rendered position vector
// (stable for the entity's lifetime), so callers need no extra fields.
const motionState = new WeakMap<Vector3, { lastSampleMs: number }>();

const MAX_DELTA_SECONDS = 0.1;
// Beyond this jump we assume a teleport / spawn / chunk load and snap rather
// than sliding the entity across the world.
const SNAP_DISTANCE_SQ = 6 * 6;

export function dampPosition(
  current: Vector3,
  target: Vector3,
  factorAt60: number,
): void {
  const now = performance.now();
  let state = motionState.get(current);
  if (!state) {
    state = { lastSampleMs: 0 };
    motionState.set(current, state);
  }

  const dtSeconds =
    state.lastSampleMs === 0
      ? 1 / 60
      : Math.min((now - state.lastSampleMs) / 1000, MAX_DELTA_SECONDS);
  state.lastSampleMs = now;

  if (factorAt60 >= 1 || current.distanceToSquared(target) > SNAP_DISTANCE_SQ) {
    current.copy(target);
    return;
  }

  // Convert the legacy per-frame-at-60fps lerp factor into a time-based rate so
  // the catch-up speed is identical regardless of frame rate.
  const ratePerSecond = -Math.log(1 - factorAt60) * 60;
  const alpha = 1 - Math.exp(-ratePerSecond * dtSeconds);
  current.lerp(target, alpha);
}
