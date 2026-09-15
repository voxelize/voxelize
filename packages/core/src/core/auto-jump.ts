import { AABB } from "@voxelize/aabb";
import { SweepHit } from "@voxelize/physics-engine";

/**
 * Numeric slop lifting probe boxes off the plane they rest on: a body seated
 * exactly on its floor would otherwise report every floor block ahead as a
 * face hit, and the landing box would report the tread it is meant to land
 * on. The engine seats resting bodies an epsilon up for the same reason; a
 * teleport can leave one exactly flush, so the planner lifts for itself.
 */
const PROBE_LIFT = 1e-4;

/**
 * The geometry queries auto-jump needs, satisfied by the physics `Engine`.
 */
export type AutoJumpProbe = {
  sweepObstruction: (box: AABB, vector: number[]) => SweepHit | null;
  isSweepClear: (box: AABB, vector: number[]) => boolean;
};

export type AutoJumpParams = {
  /** Blocks scanned ahead of the body along its travel direction. */
  lookahead: number;
  /**
   * Rises at or below this are left to auto-stepping (the body's
   * `stepHeight`); auto-jump only fires for taller ledges.
   */
  minHeight: number;
  /** Tallest rise a jump is trusted to clear. */
  maxHeight: number;
  /** Headroom the body needs straight up to launch without hitting its head. */
  apexHeight: number;
  /**
   * Along-face to into-face travel ratio above which contact is a graze that
   * slides along the ledge instead of hopping onto it. `0` disables.
   */
  grazeRatio: number;
};

export type AutoJumpPlan = {
  /** Height of the ledge above the feet, in blocks. */
  height: number;
  /** Distance from the body to the ledge's face along the travel direction. */
  distance: number;
};

/**
 * Decide whether a grounded body walking along `dir` (unit XZ) should jump
 * now to land on the ledge ahead of it.
 *
 * Fires only for a ledge inside `lookahead` that is taller than a step but
 * no taller than a jump clears, approached rather than grazed, with room to
 * launch overhead and a clear landing at the ledge's height. The look-ahead
 * is what makes it feel like a hop taken at the block rather than a bump:
 * the jump starts before contact, so the feet pass the ledge's top plane on
 * the way up.
 */
export function planAutoJump(
  probe: AutoJumpProbe,
  box: AABB,
  dir: [number, number],
  params: AutoJumpParams,
): AutoJumpPlan | null {
  const [dx, dz] = dir;
  const { lookahead, minHeight, maxHeight, apexHeight, grazeRatio } = params;
  if (lookahead <= 0) return null;

  const lifted = box.clone().translate([0, PROBE_LIFT, 0]);
  const hit = probe.sweepObstruction(lifted, [
    dx * lookahead,
    0,
    dz * lookahead,
  ]);
  if (!hit || hit.axis === 1) return null;

  if (grazeRatio > 0) {
    const ratio = Math.abs(dx / dz);
    const isGrazingX = hit.axis === 0 && ratio < 1 / grazeRatio;
    const isGrazingZ = hit.axis === 2 && ratio > grazeRatio;
    if (isGrazingX || isGrazingZ) return null;
  }

  const height = hit.top - box.minY;
  if (!(height > minHeight) || height > maxHeight) return null;

  // Room to launch: the whole body must be able to rise to the apex where
  // it stands, or the jump would bonk instead of clearing the ledge.
  if (!probe.isSweepClear(lifted, [0, apexHeight, 0])) return null;

  // Room to land: the body raised onto the ledge's plane must be able to
  // travel just far enough to stand wholly on the tread. A taller wall
  // behind the first block, or a low ceiling over the tread, shows up here;
  // the next riser of a staircase, one tread further on, does not.
  const footprint = Math.abs(dx) * box.width + Math.abs(dz) * box.depth;
  const landingRun = hit.distance + footprint;
  const raised = lifted.clone().translate([0, height, 0]);
  if (!probe.isSweepClear(raised, [dx * landingRun, 0, dz * landingRun])) {
    return null;
  }

  return { height, distance: hit.distance };
}
