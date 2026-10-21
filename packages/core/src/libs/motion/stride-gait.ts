import type { Vector3 } from "three";

/// Tunables for one land animal's stride cycle. Swing amplitude and cadence
/// are both derived from the body's travel, so the legs match the ground
/// covered instead of windmilling at a fixed arc.
export interface StrideGaitParams {
  /// Ground covered by one full cycle (each leg forward and back once, i.e.
  /// two footfalls of a diagonal pair) at full swing amplitude. For
  /// slide-free footfalls this approximates 4 * sin(maxLegSwing) * legLength.
  strideLength: number;
  /// Cadence ceiling in cycles per second. Below `cadenceKnee` of it the
  /// cadence follows the ground exactly; above, it bends toward the ceiling
  /// (tanh) so walk → trot → flee keeps accelerating the legs without a flat
  /// plateau, while still rejecting the old 10–18 Hz windmill.
  maxStrideHz: number;
  /// Travel speed (world units/sec) at which the swing reaches full
  /// amplitude; slower travel shortens the arc proportionally. Past this
  /// the effective stride lengthens into a gallop (see gallopStrideBoost).
  fullSwingSpeed: number;
  /// Amplitude floor while creeping, so the slowest drift still reads as
  /// small deliberate steps rather than a frozen glide.
  minSwingScale: number;
  /// Extra effective stride length at full gallop, as a fraction of the
  /// base. Longer strides let flee cover ground with a readable beat
  /// instead of just cranking phase rate.
  gallopStrideBoost: number;
  /// Speed span (world units/sec) above fullSwingSpeed over which the
  /// gallop boost ramps from 0 → full. Matches a fast grazer.s flee
  /// headroom (~3× wander) without needing per-species overrides.
  gallopSpeedSpan: number;
  /// Fraction of `maxStrideHz` up to which the cadence is exactly the
  /// ground's demand (zero slip); the soft bend toward the ceiling starts
  /// there. 0 bends over the whole range (the pure tanh soft cap).
  cadenceKnee: number;
  /// Extra swing amplitude, as a fraction of the full walk swing, the legs
  /// reach for once the ceiling holds the cadence: the stride lengthens
  /// toward what the ground asks instead of the feet skating under a
  /// capped beat. 0 keeps the amplitude at the walk swing.
  gallopReachBoost: number;
}

/// Baseline stride derived from the shared box-critter proportions: leg
/// length and stance track the family's render scale, so ground coverage
/// per cycle does too. `strideGaitParamsForScale` packages these defaults
/// for one family; species with unusual builds pass their own params.
const STRIDE_LENGTH_PER_SCALE = 0.65;
/// Ground a slide-free leg pair sweeps per cycle, as a multiple of
/// `legLength * maxLegSwing` (the small-swing foot reach). Each of the two
/// legs is planted for half a cycle and sweeps `2 * legLength * maxLegSwing`
/// of ground there, so the pair covers four times that. The linear (small-
/// swing) reach — rather than `sin(maxLegSwing)` — is deliberate: a walk runs
/// at a reduced swing amplitude (swingScale < 1), and both the foot reach and
/// the stride's ground-per-cycle scale linearly with swingScale, so this form
/// stays slide-free across the whole walk-speed range. A full-amplitude
/// `sin()` form only matches at max swing and leaves the reduced-swing walk
/// over-swinging. Families whose leg reach doesn't track their overall render
/// scale (stumpy-legged, long-bodied) derive `strideLength` from their actual
/// leg geometry via `strideGaitParamsForLeg` instead of the render-scale proxy.
const STRIDE_GROUND_PER_LEG_PAIR = 4;
/// Soft headroom: walk sits near ~3.5 Hz; flee (6–10 u/s after damping)
/// climbs into the mid-6s without the pre-#75 windmill. 5.25 left bolt
/// cadence too close to a fast walk after gait #75's hard 3.5 cap.
const DEFAULT_MAX_STRIDE_HZ = 6.75;
const DEFAULT_FULL_SWING_SPEED = 2.5;
const DEFAULT_MIN_SWING_SCALE = 0.35;
/// Mild lengthen only — most of the flee ramp must come from Hz, not from
/// stretching stride enough to hold cadence near walk rate.
const DEFAULT_GALLOP_STRIDE_BOOST = 0.2;
const DEFAULT_GALLOP_SPEED_SPAN = 8.0;

/// The walkers (every quadruped and biped family whose legs are measured
/// from its mesh) pace from their legs: blocks are about metres, so the
/// pendulum and Froude scaling of real animals carry over.
const GRAVITY = 9.81;
/// Cadence ceiling as a pendulum: fCap(L) = 2.8 Hz · sqrt(0.85 / L), so a
/// deer (L ≈ 0.85) bounds at about 2.8 Hz where the old flat 6.75 Hz cap let
/// it flicker, and a fox (L ≈ 0.16) still patters near 6.5 Hz.
const WALKER_CADENCE_REF_HZ = 2.8;
const WALKER_CADENCE_REF_LEG = 0.85;
const WALKER_CADENCE_MIN_HZ = 2.2;
const WALKER_CADENCE_MAX_HZ = 8.0;
/// Full swing is reached at the walk → trot Froude number: v = sqrt(Fr·g·L),
/// about 1.8 u/s for a deer and 0.8 u/s for a fox, so a small animal's
/// walk is a full stride and not a low-amplitude patter.
const WALKER_FULL_SWING_FROUDE = 0.4;
const WALKER_MIN_SWING_SCALE = 0.35;
/// The ground follows the cadence exactly up to 70% of the ceiling.
const WALKER_CADENCE_KNEE = 0.7;
/// Legs reach up to 30% further than the walk swing once the ceiling holds.
const WALKER_GALLOP_REACH_BOOST = 0.3;
/// Fallback when a mesh could not be measured: the leg a render scale of 1
/// implies under the old proxy (0.65 of ground per cycle at a 0.42 swing).
const FALLBACK_LEG_PER_SCALE =
  STRIDE_LENGTH_PER_SCALE / (STRIDE_GROUND_PER_LEG_PAIR * 0.42);
const FALLBACK_LEG_SWING = 0.42;

function strideGaitParamsWithLength(strideLength: number): StrideGaitParams {
  return {
    strideLength,
    maxStrideHz: DEFAULT_MAX_STRIDE_HZ,
    fullSwingSpeed: DEFAULT_FULL_SWING_SPEED,
    minSwingScale: DEFAULT_MIN_SWING_SCALE,
    gallopStrideBoost: DEFAULT_GALLOP_STRIDE_BOOST,
    gallopSpeedSpan: DEFAULT_GALLOP_SPEED_SPAN,
    cadenceKnee: 0,
    gallopReachBoost: 0,
  };
}

/// Walker tuning for a family whose mesh could not be measured: the same
/// size-scaled law, on the leg the render scale implies.
export function strideGaitParamsForScale(bodyScale: number): StrideGaitParams {
  return strideGaitParamsForWalker(
    FALLBACK_LEG_PER_SCALE * bodyScale,
    FALLBACK_LEG_SWING,
  );
}

/// Stride params for a family whose leg reach is known directly, so ground
/// coverage per cycle comes from anatomy (leg length and swing arc) rather
/// than the render-scale proxy. Use this when render scale over- or
/// under-states the legs — e.g. a bulky, stumpy-legged biped whose scale
/// says "large" but whose short legs cover little ground per step.
export function strideGaitParamsForLeg(
  legLength: number,
  maxLegSwing: number,
): StrideGaitParams {
  return strideGaitParamsWithLength(
    STRIDE_GROUND_PER_LEG_PAIR * legLength * maxLegSwing,
  );
}

/// Pendulum cadence ceiling for a walker with legs of `legLength` (world
/// units): long legs swing slowly, short ones fast.
export function walkerCadenceCeilingHz(legLength: number): number {
  const length = Math.max(legLength, 1e-3);
  return Math.min(
    Math.max(
      WALKER_CADENCE_REF_HZ * Math.sqrt(WALKER_CADENCE_REF_LEG / length),
      WALKER_CADENCE_MIN_HZ,
    ),
    WALKER_CADENCE_MAX_HZ,
  );
}

/// Speed at which a walker's swing reaches its full walk amplitude.
export function walkerFullSwingSpeed(legLength: number): number {
  return Math.sqrt(
    WALKER_FULL_SWING_FROUDE * GRAVITY * Math.max(legLength, 1e-3),
  );
}

/// Stride params for a land walker from the legs it actually draws (world
/// units: mesh leg times instance size) and the swing amplitude its animator
/// uses at full stride. The legs swing as they always did — a continuous
/// sine, opposite pairs alternating — but paced so each cycle covers exactly
/// the ground the body does, with a cadence ceiling and a full-swing speed
/// that both follow the leg length, so a deer's long legs bound at a
/// readable beat and a small rodent.s legs patter.
export function strideGaitParamsForWalker(
  legLength: number,
  maxLegSwing: number,
): StrideGaitParams {
  return {
    strideLength: STRIDE_GROUND_PER_LEG_PAIR * legLength * maxLegSwing,
    maxStrideHz: walkerCadenceCeilingHz(legLength),
    fullSwingSpeed: walkerFullSwingSpeed(legLength),
    minSwingScale: WALKER_MIN_SWING_SCALE,
    gallopStrideBoost: 0,
    gallopSpeedSpan: 1,
    cadenceKnee: WALKER_CADENCE_KNEE,
    gallopReachBoost: WALKER_GALLOP_REACH_BOOST,
  };
}

const MIN_DELTA_SECONDS = 1e-3;
const MAX_DELTA_SECONDS = 0.1;
/// Speed estimate settles in ~100 ms so server-tick jitter in the damped
/// follow cannot pump the swing amplitude.
const SPEED_SMOOTHING_RATE = 10;
/// Amplitude eases toward its speed target in ~125 ms — fast enough to
/// track a bolt, slow enough not to pop.
const SWING_EASE_RATE = 8;
const TWO_PI = Math.PI * 2;

/// Cadence the clock runs at for the ground's demand `desiredHz`: exactly
/// the demand up to `knee` of `maxHz`, then bending toward `maxHz` with a
/// tanh so the ramp stays readable and continuous (C1 at the knee). A knee
/// of 0 is the pure soft cap, `maxHz * tanh(desiredHz / maxHz)`.
export function capCadenceHz(
  desiredHz: number,
  maxHz: number,
  knee: number,
): number {
  if (desiredHz <= 0 || maxHz <= 0) return 0;
  const kneeHz = maxHz * Math.min(Math.max(knee, 0), 1);
  if (desiredHz <= kneeHz) return desiredHz;
  const room = maxHz - kneeHz;
  if (room <= 1e-9) return maxHz;
  return kneeHz + room * Math.tanh((desiredHz - kneeHz) / room);
}

/// Distance-driven stride clock shared by every walking family. Feed it the
/// rendered (damped) position once per frame, and optionally the undamped
/// server target so a bolt's speed ramp is not muted by follow lag. It
/// advances `phase` so that one full cycle spans
/// `strideLength * swingScale * gallop` of travel — feet stay planted
/// relative to the ground — and exposes `swingScale` for the families to
/// scale their leg-swing amplitudes by.
export class StrideGait {
  /// Random start so herd mates never stride in lockstep.
  phase = Math.random() * TWO_PI;
  /// Leg-swing amplitude multiplier for this frame: the speed-tracked walk
  /// swing, times the gallop reach once the cadence ceiling holds.
  swingScale: number;
  /// The gallop lengthening applied to the stride this frame, exposed so
  /// an animator can hold its sweep amplitude to the exact stride the
  /// clock is pacing — one source, zero slip by construction.
  gallopStretch = 1;

  private params: StrideGaitParams;
  private smoothedSpeed = 0;
  /// The speed-tracked walk swing (minSwingScale … 1), before the reach.
  private swingBase: number;
  /// Gallop reach multiplier (1 … 1 + gallopReachBoost), eased.
  private reach = 1;
  private fittedLeg = 0;
  private fittedSwing = 0;

  /// Smoothed travel speed in blocks/s — the same estimate the swing
  /// amplitude tracks, exposed for state that keys off exertion (the
  /// a panting animation reads it).
  get speedEstimate(): number {
    return this.smoothedSpeed;
  }
  private lastSampleMs = 0;
  private prevX = 0;
  private prevZ = 0;
  private hasPrev = false;
  private prevTargetX = 0;
  private prevTargetZ = 0;
  private hasPrevTarget = false;

  constructor(params: StrideGaitParams) {
    this.params = params;
    this.swingBase = params.minSwingScale;
    this.swingScale = this.swingBase;
  }

  /// Swaps the tunables under a running clock: the phase, speed estimate
  /// and swing carry on, so a mesh swap mid-stride does not pop the legs.
  setParams(params: StrideGaitParams): void {
    this.params = params;
  }

  /// Paces this clock from the legs the mesh actually draws (mesh leg
  /// length times instance size) and the animator's full-stride swing.
  /// Cheap to call every frame: it only rebuilds the params when the leg
  /// changes (a variant or baby swap, a resize). A null leg — the mesh could
  /// not be measured — keeps whatever the clock already paces from.
  fitWalker(
    meshLegLength: number | null | undefined,
    size: number,
    maxLegSwing: number,
  ): void {
    if (meshLegLength == null || !(meshLegLength > 0) || !(size > 0)) return;
    const legLength = meshLegLength * size;
    if (legLength === this.fittedLeg && maxLegSwing === this.fittedSwing) {
      return;
    }
    this.fittedLeg = legLength;
    this.fittedSwing = maxLegSwing;
    this.setParams(strideGaitParamsForWalker(legLength, maxLegSwing));
  }

  update(position: Vector3, target?: Vector3): number {
    const now = performance.now();
    // Two clocks on purpose: the CLAMPED dt feeds the smoothing EMAs
    // (a hitch must not slam them), but the REAL dt drives the phase
    // advance. Clamping there breaks the distance tie on slow renderers:
    // a 0.22s frame clamped to 0.1s reads travel at 2.2x true speed, the
    // legs sweep 2.2x faster than the ground passes, and every stance
    // hoof moonwalks — the skating an external review caught at 4.5 fps.
    const dtReal =
      this.lastSampleMs === 0
        ? 1 / 60
        : Math.max((now - this.lastSampleMs) / 1000, MIN_DELTA_SECONDS);
    const dtSeconds = Math.min(dtReal, MAX_DELTA_SECONDS);
    this.lastSampleMs = now;

    // Horizontal travel of the rendered body this frame: the ground the
    // feet must account for. Vertical motion (falls, hops) never cycles
    // the legs.
    let renderedTravel = 0;
    if (this.hasPrev) {
      const dx = position.x - this.prevX;
      const dz = position.z - this.prevZ;
      renderedTravel = Math.sqrt(dx * dx + dz * dz);
    }
    this.prevX = position.x;
    this.prevZ = position.z;
    this.hasPrev = true;

    // Undamped server target travel leads the visual follow on a bolt. Use
    // the max so flee cadence ramps with intent, not with catch-up lag —
    // without muting walk (target and render agree while cruising).
    let targetTravel = 0;
    if (target) {
      if (this.hasPrevTarget) {
        const dx = target.x - this.prevTargetX;
        const dz = target.z - this.prevTargetZ;
        targetTravel = Math.sqrt(dx * dx + dz * dz);
      }
      this.prevTargetX = target.x;
      this.prevTargetZ = target.z;
      this.hasPrevTarget = true;
    } else {
      this.hasPrevTarget = false;
    }

    const travel = Math.max(renderedTravel, targetTravel);

    const {
      strideLength,
      maxStrideHz,
      fullSwingSpeed,
      minSwingScale,
      gallopStrideBoost,
      gallopSpeedSpan,
      cadenceKnee,
      gallopReachBoost,
    } = this.params;

    const speedAlpha = 1 - Math.exp(-SPEED_SMOOTHING_RATE * dtSeconds);
    this.smoothedSpeed +=
      (travel / dtSeconds - this.smoothedSpeed) * speedAlpha;

    const swingTarget = Math.min(
      Math.max(this.smoothedSpeed / fullSwingSpeed, minSwingScale),
      1,
    );
    const swingAlpha = 1 - Math.exp(-SWING_EASE_RATE * dtSeconds);
    this.swingBase += (swingTarget - this.swingBase) * swingAlpha;

    // Past full swing the animal lengthens its stride into a gallop so
    // flee covers more ground per cycle — cadence still rises with speed,
    // just not linearly into a blur.
    const gallopBlend = Math.min(
      Math.max(
        (this.smoothedSpeed - fullSwingSpeed) / Math.max(gallopSpeedSpan, 1e-3),
        0,
      ),
      1,
    );
    const lengthen = 1 + gallopStrideBoost * gallopBlend;
    const baseStride = strideLength * this.swingBase * lengthen;

    // Once the ceiling holds the cadence, the legs reach further instead:
    // the swing grows (up to the boost) until the longer stride meets the
    // ground's demand, and only past that do the feet skate. Steered by the
    // smoothed speed so a jittery frame cannot pump the amplitude.
    let reachTarget = 1;
    if (gallopReachBoost > 0 && baseStride > 1e-6) {
      const demandHz = this.smoothedSpeed / baseStride;
      const heldHz = capCadenceHz(demandHz, maxStrideHz, cadenceKnee);
      if (heldHz > 1e-6) {
        reachTarget = Math.min(demandHz / heldHz, 1 + gallopReachBoost);
      }
    }
    this.reach += (reachTarget - this.reach) * swingAlpha;
    this.gallopStretch = lengthen * this.reach;
    this.swingScale = this.swingBase * this.reach;
    const effectiveStride = baseStride * this.reach;

    // Cadence tracks horizontal speed continuously: walk → trot → flee.
    // Soft-capping (not a hard min) is what keeps the ramp-up/ramp-down
    // readable — a hard ceiling at walk-adjacent Hz was the Ian regression.
    // The rate uses THIS frame's real travel over real time, so in the
    // identity region the advance is exactly travel/effectiveStride —
    // ground-tied at any frame rate.
    const desiredHz =
      effectiveStride > 1e-6 ? travel / dtReal / effectiveStride : 0;
    // One frame never advances close to a full cycle: past that, wrapped
    // phase becomes ambiguous — footfall detectors would silently drop
    // whole cycles of strikes on a seconds-long hitch or tab resume. The
    // cap momentarily loosens the ground tie on such frames, which is
    // the cheaper artifact by far.
    const advance = Math.min(
      TWO_PI * capCadenceHz(desiredHz, maxStrideHz, cadenceKnee) * dtReal,
      TWO_PI * 0.45,
    );
    this.phase += advance;

    return dtSeconds;
  }
}
