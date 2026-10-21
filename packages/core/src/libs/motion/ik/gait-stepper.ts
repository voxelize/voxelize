import * as THREE from "three";

export interface GaitProfile {
  stepTriggerDistance: number;
  // Feet lagging beyond trigger * ratio step immediately, ignoring group
  // alternation and cooldown, so bursts never stretch legs.
  emergencyTriggerRatio: number;
  // Vertical anchor-vs-home lag that forces a replant, so feet step off a
  // ledge the body has already descended (or climbed) instead of staying
  // planted on the old level while the body tunnels through the step.
  verticalTriggerDistance: number;
  stepDuration: number;
  // Fraction of a stride period a swing may occupy. At speed the effective
  // swing duration shrinks to dutyFactor * maxStepDistance / speed, so
  // short-legged species cadence up instead of dragging anchors.
  swingDutyFactor: number;
  // Floor under that speed-derived shrink. A mob whose workspace is small
  // next to its travel speed otherwise plays a whole swing in a handful of
  // frames, which reads as the foot teleporting rather than stepping.
  minSwingDuration: number;
  stepHeight: number;
  // Shapes the lift arc: the sine peak lands where swingPhase raised to this
  // power reaches 0.5. Below 1 the foot lifts early and descends along a
  // steeper approach, so it travels up and over its target instead of
  // skimming a symmetric hump.
  stepArcSkew: number;
  stepLeadTime: number;
  maxFootRaise: number;
  maxFootDrop: number;
  groundProbeUp: number;
  // Planted anchors farther than this fraction of true leg length from
  // their reach origin must restep; past the full length it is an
  // emergency. A raised chassis lifts the origins, consuming reach.
  reachTriggerRatio: number;
  // Hysteresis: a wanted step is skipped while the best candidate target
  // sits within this distance of the current anchor (already settled).
  settledDistance: number;
  // Per-foot refractory after a completed replant; only emergencies may
  // step again sooner. Also the retry cadence for tucked feet.
  stepCooldown: number;
  // Neutral pose for feet with no valid ground: raised above home and
  // pulled toward the reach origin, eased at stepDuration.
  tuckRaise: number;
  tuckInwardRatio: number;
  // How far into a swing the active group must be before the next group may
  // start lifting. 1 is strictly sequential -- a group lands before the next
  // leaves, so a cycle costs one swing per group. Lower values overlap
  // neighbouring phases into a metachronal wave: more groups keep the same
  // cycle length, and no two adjacent limbs leave the ground together.
  groupOverlapPhase: number;
}

/// Body scale stretches every length a gait reasons about and leaves every
/// duration, ratio and phase alone. Spreading the profile rather than
/// re-listing it means a field added to `GaitProfile` cannot be silently
/// dropped on its way to `updateGait`.
export function scaleGaitProfile(
  profile: GaitProfile,
  size: number,
): GaitProfile {
  return {
    ...profile,
    stepTriggerDistance: profile.stepTriggerDistance * size,
    verticalTriggerDistance: profile.verticalTriggerDistance * size,
    stepHeight: profile.stepHeight * size,
    maxFootRaise: profile.maxFootRaise * size,
    maxFootDrop: profile.maxFootDrop * size,
    settledDistance: profile.settledDistance * size,
    tuckRaise: profile.tuckRaise * size,
  };
}

export type GroundHeightSampler = (
  x: number,
  y: number,
  z: number,
) => number | null;

export interface GaitReachInput {
  // World-space reach origins (hips / arm bases), including any body lift.
  origins: readonly THREE.Vector3[];
  // True max origin-to-foot distance in world units.
  legLength: number;
  // Workspace-derived cap on how far a swing target may lead its home.
  maxStepDistance: number;
}

export class GaitFoot {
  readonly group: number;
  readonly position = new THREE.Vector3();
  readonly anchor = new THREE.Vector3();
  readonly swingFrom = new THREE.Vector3();
  readonly swingTo = new THREE.Vector3();
  swingPhase = 0;
  swingDuration = 0;
  cooldown = 0;
  isPlanted = false;
  isTucked = false;
  isInitialized = false;
  hasRevalidatedSwing = false;

  constructor(group: number) {
    this.group = group;
  }
}

export class GaitState {
  readonly feet: GaitFoot[];
  activeGroup = 0;

  constructor(footGroups: readonly number[]) {
    this.feet = footGroups.map((group) => new GaitFoot(group));
  }

  reset(): void {
    for (const foot of this.feet) {
      foot.isInitialized = false;
      foot.isPlanted = false;
      foot.isTucked = false;
      foot.swingPhase = 0;
      foot.cooldown = 0;
      foot.hasRevalidatedSwing = false;
    }
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function isStepWanted(
  foot: GaitFoot,
  home: THREE.Vector3,
  origin: THREE.Vector3,
  legLength: number,
  profile: GaitProfile,
  ascentRise: number,
): boolean {
  // The ascent term is the uphill mirror of the vertical anchor-vs-home lag:
  // rising terrain under the chassis asks feet to replant onto the upper
  // level before the body is carried up, so the legs lead the climb. Settled
  // hysteresis still skips feet whose best target is where they stand.
  return (
    horizontalDistance(foot.anchor, home) > profile.stepTriggerDistance ||
    Math.abs(foot.anchor.y - home.y) > profile.verticalTriggerDistance ||
    ascentRise > profile.verticalTriggerDistance ||
    foot.anchor.distanceTo(origin) > legLength * profile.reachTriggerRatio
  );
}

function isStepEmergency(
  foot: GaitFoot,
  home: THREE.Vector3,
  origin: THREE.Vector3,
  legLength: number,
  profile: GaitProfile,
): boolean {
  return (
    horizontalDistance(foot.anchor, home) >
      profile.stepTriggerDistance * profile.emergencyTriggerRatio ||
    Math.abs(foot.anchor.y - home.y) >
      profile.verticalTriggerDistance * profile.emergencyTriggerRatio ||
    foot.anchor.distanceTo(origin) > legLength
  );
}

const searchTarget = new THREE.Vector3();
const tuckTarget = new THREE.Vector3();

function findGroundTarget(
  home: THREE.Vector3,
  origin: THREE.Vector3,
  leadX: number,
  leadZ: number,
  profile: GaitProfile,
  sampleGround: GroundHeightSampler,
  ascentRise: number,
  out: THREE.Vector3,
): boolean {
  // Deterministic candidate ladder, biased toward body travel: full lead,
  // bisected lead, home, then inward toward the reach origin. The first
  // candidate with steppable ground wins, so per-frame sampler noise at a
  // block edge cannot flip the choice. At most four point probes.
  // During an ascent the upward validation window widens by ascentRise so
  // leading feet may land on the level the body is about to climb onto.
  const probeY = home.y + profile.groundProbeUp;
  const maxRaise = profile.maxFootRaise + ascentRise;
  const isLeading = Math.abs(leadX) > 1e-6 || Math.abs(leadZ) > 1e-6;
  for (let candidate = isLeading ? 0 : 2; candidate < 4; candidate++) {
    let x: number;
    let z: number;
    if (candidate === 0) {
      x = home.x + leadX;
      z = home.z + leadZ;
    } else if (candidate === 1) {
      x = home.x + leadX * 0.5;
      z = home.z + leadZ * 0.5;
    } else if (candidate === 2) {
      x = home.x;
      z = home.z;
    } else {
      x = home.x + (origin.x - home.x) * profile.tuckInwardRatio;
      z = home.z + (origin.z - home.z) * profile.tuckInwardRatio;
    }
    const groundY = sampleGround(x, probeY, z);
    if (groundY === null) continue;
    if (groundY > home.y + maxRaise) continue;
    if (groundY < home.y - profile.maxFootDrop) continue;
    out.set(x, groundY, z);
    return true;
  }
  return false;
}

function setTuckTarget(
  home: THREE.Vector3,
  origin: THREE.Vector3,
  profile: GaitProfile,
  out: THREE.Vector3,
): void {
  out.set(
    home.x + (origin.x - home.x) * profile.tuckInwardRatio,
    home.y + profile.tuckRaise,
    home.z + (origin.z - home.z) * profile.tuckInwardRatio,
  );
}

function tuckFoot(foot: GaitFoot, profile: GaitProfile): void {
  foot.isTucked = true;
  foot.isPlanted = false;
  foot.cooldown = profile.stepCooldown;
}

function beginSwing(
  foot: GaitFoot,
  target: THREE.Vector3,
  duration: number,
): void {
  foot.swingTo.copy(target);
  foot.swingPhase = 0;
  foot.swingDuration = duration;
  foot.isPlanted = false;
  foot.isTucked = false;
  foot.hasRevalidatedSwing = false;
}

export function updateGait(
  state: GaitState,
  profile: GaitProfile,
  homes: readonly THREE.Vector3[],
  velocity: THREE.Vector3,
  deltaSeconds: number,
  sampleGround: GroundHeightSampler,
  reach: GaitReachInput,
  // How far the terrain under the chassis rises above the current support
  // level (0 on flat ground). Widens uphill foot-target validation and asks
  // planted feet to replant, so legs climb a step before the body does.
  ascentRise = 0,
): void {
  const { feet } = state;

  const speed = Math.hypot(velocity.x, velocity.z);
  let swingDuration = profile.stepDuration;
  if (speed > 1e-4) {
    swingDuration = THREE.MathUtils.clamp(
      (profile.swingDutyFactor * reach.maxStepDistance) / speed,
      Math.min(profile.minSwingDuration, profile.stepDuration),
      profile.stepDuration,
    );
  }

  let leadX = velocity.x * profile.stepLeadTime;
  let leadZ = velocity.z * profile.stepLeadTime;
  const leadLength = Math.hypot(leadX, leadZ);
  if (leadLength > reach.maxStepDistance && leadLength > 1e-6) {
    const leadScale = reach.maxStepDistance / leadLength;
    leadX *= leadScale;
    leadZ *= leadScale;
  }

  let isActiveGroupReleased = true;
  for (const foot of feet) {
    if (foot.group !== state.activeGroup || !foot.isInitialized) continue;
    if (foot.isPlanted || foot.isTucked) continue;
    if (foot.swingPhase >= profile.groupOverlapPhase) continue;
    isActiveGroupReleased = false;
    break;
  }

  if (isActiveGroupReleased) {
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i];
      if (
        foot.group === state.activeGroup ||
        !foot.isInitialized ||
        !foot.isPlanted
      ) {
        continue;
      }
      if (
        isStepWanted(
          foot,
          homes[i],
          reach.origins[i],
          reach.legLength,
          profile,
          ascentRise,
        )
      ) {
        state.activeGroup = foot.group;
        break;
      }
    }
  }

  for (let i = 0; i < feet.length; i++) {
    const foot = feet[i];
    const home = homes[i];
    const origin = reach.origins[i];

    if (foot.cooldown > 0) {
      foot.cooldown = Math.max(0, foot.cooldown - deltaSeconds);
    }

    if (!foot.isInitialized) {
      if (
        findGroundTarget(
          home,
          origin,
          0,
          0,
          profile,
          sampleGround,
          ascentRise,
          searchTarget,
        )
      ) {
        foot.anchor.copy(searchTarget);
        foot.position.copy(foot.anchor);
        foot.isPlanted = true;
        foot.isTucked = false;
      } else {
        tuckFoot(foot, profile);
        setTuckTarget(home, origin, profile, tuckTarget);
        foot.position.copy(tuckTarget);
      }
      foot.isInitialized = true;
      continue;
    }

    if (foot.isTucked) {
      setTuckTarget(home, origin, profile, tuckTarget);
      foot.position.lerp(
        tuckTarget,
        Math.min(1, deltaSeconds / Math.max(profile.stepDuration, 1e-3)),
      );
      if (foot.cooldown <= 0) {
        if (
          findGroundTarget(
            home,
            origin,
            leadX,
            leadZ,
            profile,
            sampleGround,
            ascentRise,
            searchTarget,
          )
        ) {
          foot.swingFrom.copy(foot.position);
          beginSwing(foot, searchTarget, swingDuration);
        } else {
          foot.cooldown = profile.stepCooldown;
          continue;
        }
      } else {
        continue;
      }
    }

    if (foot.isPlanted) {
      if (
        !isStepWanted(foot, home, origin, reach.legLength, profile, ascentRise)
      ) {
        foot.position.copy(foot.anchor);
        continue;
      }
      const isEmergency = isStepEmergency(
        foot,
        home,
        origin,
        reach.legLength,
        profile,
      );
      if (
        !isEmergency &&
        (foot.cooldown > 0 || foot.group !== state.activeGroup)
      ) {
        foot.position.copy(foot.anchor);
        continue;
      }
      if (
        !findGroundTarget(
          home,
          origin,
          leadX,
          leadZ,
          profile,
          sampleGround,
          ascentRise,
          searchTarget,
        )
      ) {
        tuckFoot(foot, profile);
        continue;
      }
      if (searchTarget.distanceTo(foot.anchor) < profile.settledDistance) {
        foot.position.copy(foot.anchor);
        continue;
      }
      foot.swingFrom.copy(foot.anchor);
      beginSwing(foot, searchTarget, swingDuration);
    }

    foot.swingPhase += deltaSeconds / Math.max(foot.swingDuration, 1e-3);

    if (!foot.hasRevalidatedSwing && foot.swingPhase >= 0.5) {
      // Committed targets are only re-chosen if their ground vanished.
      foot.hasRevalidatedSwing = true;
      const groundY = sampleGround(
        foot.swingTo.x,
        home.y + profile.groundProbeUp,
        foot.swingTo.z,
      );
      const isTargetValid =
        groundY !== null &&
        groundY <= home.y + profile.maxFootRaise + ascentRise &&
        groundY >= home.y - profile.maxFootDrop;
      if (!isTargetValid) {
        if (
          findGroundTarget(
            home,
            origin,
            leadX,
            leadZ,
            profile,
            sampleGround,
            ascentRise,
            searchTarget,
          )
        ) {
          foot.swingFrom.copy(foot.position);
          foot.swingTo.copy(searchTarget);
          foot.swingPhase = 0;
        } else {
          tuckFoot(foot, profile);
          continue;
        }
      }
    }

    if (foot.swingPhase >= 1) {
      foot.anchor.copy(foot.swingTo);
      foot.position.copy(foot.anchor);
      foot.isPlanted = true;
      foot.cooldown = profile.stepCooldown;
      continue;
    }

    const t = smoothstep(foot.swingPhase);
    foot.position.lerpVectors(foot.swingFrom, foot.swingTo, t);
    foot.position.y +=
      Math.sin(Math.PI * Math.pow(foot.swingPhase, profile.stepArcSkew)) *
      profile.stepHeight;
  }
}

export function sampleChassisGround(
  sampleGround: GroundHeightSampler,
  centerX: number,
  centerZ: number,
  probeStartY: number,
  maxGroundY: number,
  cosYaw: number,
  sinYaw: number,
  halfWidth: number,
  halfDepth: number,
): number | null {
  // Highest steppable ground under the chassis footprint (center + corners).
  // Probes returning ground above maxGroundY are walls, not terrain the body
  // is crossing, and are ignored so the clamp never shoves bodies up cliffs.
  let highest: number | null = null;
  for (let corner = 0; corner < 5; corner++) {
    let x = centerX;
    let z = centerZ;
    if (corner > 0) {
      const sx = corner < 3 ? -halfWidth : halfWidth;
      const sz = corner % 2 === 0 ? -halfDepth : halfDepth;
      x += cosYaw * sx + sinYaw * sz;
      z += -sinYaw * sx + cosYaw * sz;
    }
    const groundY = sampleGround(x, probeStartY, z);
    if (groundY === null || groundY > maxGroundY) continue;
    if (highest === null || groundY > highest) highest = groundY;
  }
  return highest;
}

export function clampLiftToClearance(
  lift: number,
  chassisBottomY: number,
  groundY: number | null,
  clearance: number,
): number {
  // Hard floor for the smoothed body height: whatever the support plane or
  // easing wants, the chassis bottom never dips below ground + clearance.
  if (groundY === null) return lift;
  return Math.max(lift, groundY + clearance - chassisBottomY);
}

export function computeBodySupport(
  state: GaitState,
  bodyX: number,
  bodyZ: number,
  maxTilt: number,
  minPlantedCount: number,
  outNormal: THREE.Vector3,
): number | null {
  // Least-squares plane through the planted feet, expressed as a mean
  // support height plus a world-space plane normal (twist-free tilt).
  // Too few planted feet (stuck fallback tucked the rest) returns null so
  // the body rides the server position; degenerate layouts fall back flat.
  let plantedCount = 0;
  let meanY = 0;
  for (const foot of state.feet) {
    if (!foot.isInitialized || !foot.isPlanted) continue;
    plantedCount++;
    meanY += foot.anchor.y;
  }
  if (plantedCount === 0 || plantedCount < minPlantedCount) {
    outNormal.set(0, 1, 0);
    return null;
  }
  meanY /= plantedCount;

  if (plantedCount < 3) {
    outNormal.set(0, 1, 0);
    return meanY;
  }

  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  let sxy = 0;
  let szy = 0;
  for (const foot of state.feet) {
    if (!foot.isInitialized || !foot.isPlanted) continue;
    const dx = foot.anchor.x - bodyX;
    const dz = foot.anchor.z - bodyZ;
    const dy = foot.anchor.y - meanY;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }

  const det = sxx * szz - sxz * sxz;
  if (Math.abs(det) < 1e-6) {
    outNormal.set(0, 1, 0);
    return meanY;
  }

  let slopeX = (sxy * szz - szy * sxz) / det;
  let slopeZ = (szy * sxx - sxy * sxz) / det;

  const slopeLength = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
  const maxSlope = Math.tan(maxTilt);
  if (slopeLength > maxSlope) {
    const scale = maxSlope / slopeLength;
    slopeX *= scale;
    slopeZ *= scale;
  }

  outNormal.set(-slopeX, 1, -slopeZ).normalize();
  return meanY;
}
