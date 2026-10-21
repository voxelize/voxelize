/// One-shot strike presentation driven by the server's replicated
/// `attackSeq` counter: the
/// counter advancing restarts a wall-clock envelope of
/// windup (coil) -> strike (spring + hit) -> recover, and each family maps
/// the resulting pose onto its own body. The strike is an instant on the
/// server; everything here is pure presentation.
///
/// Pitch signs follow the entity euler convention: negative X pitches the
/// nose up, positive pitches it down.
export interface AttackMotionProfile {
  durationMs: number;
  /// Fraction of the envelope spent coiling before the spring.
  windupEndFraction: number;
  /// Fraction at which the strike lands; the remainder settles to neutral.
  strikeEndFraction: number;
  /// World units the body sinks while coiling (negative raises instead —
  /// a bear rearing up).
  crouchDepth: number;
  /// Peak world units of the strike hop arc; the body leaves the ground on
  /// the spring and lands exactly as the strike connects.
  hopHeight: number;
  /// World units of forward surge along the facing during the strike.
  lungeDistance: number;
  /// Body pitch held at full coil.
  windupPitch: number;
  /// Body pitch at the moment the strike lands.
  strikePitch: number;
  /// Head-bone pitch folded into the strike (the bite dip or the toss
  /// fling), applied on top of head-look.
  strikeHeadPitch: number;
}

export interface AttackMotionPose {
  lift: number;
  lunge: number;
  bodyPitch: number;
  headPitch: number;
  windupBlend: number;
  strikeBlend: number;
}

export class AttackMotion {
  private lastSeq: number | null = null;
  private startedAtMs = 0;

  readonly pose: AttackMotionPose = {
    lift: 0,
    lunge: 0,
    bodyPitch: 0,
    headPitch: 0,
    windupBlend: 0,
    strikeBlend: 0,
  };

  constructor(private readonly profile: AttackMotionProfile) {}

  observe(seq: number | undefined): void {
    if (seq === undefined || seq === this.lastSeq) return;
    // The first observed value is the baseline, not a strike — an attacker
    // entering render range must not greet the player mid-lunge.
    if (this.lastSeq !== null) {
      this.startedAtMs = performance.now();
    }
    this.lastSeq = seq;
  }

  get isActive(): boolean {
    return (
      this.startedAtMs !== 0 &&
      performance.now() - this.startedAtMs < this.profile.durationMs
    );
  }

  update(nowMs: number): AttackMotionPose {
    // Mutates and returns the reusable `pose` (allocation-free per frame).
    const pose = this.pose;
    const p = this.profile;
    const t =
      this.startedAtMs === 0 ? 1 : (nowMs - this.startedAtMs) / p.durationMs;

    if (t >= 1) {
      pose.lift = 0;
      pose.lunge = 0;
      pose.bodyPitch = 0;
      pose.headPitch = 0;
      pose.windupBlend = 0;
      pose.strikeBlend = 0;
      return pose;
    }

    if (t < p.windupEndFraction) {
      // Coil: ease out into the crouch so the telegraph snaps in and holds.
      const k = t / p.windupEndFraction;
      const eased = 1 - (1 - k) * (1 - k);
      pose.lift = -p.crouchDepth * eased;
      pose.lunge = 0;
      pose.bodyPitch = p.windupPitch * eased;
      pose.headPitch = 0;
      pose.windupBlend = eased;
      pose.strikeBlend = 0;
      return pose;
    }

    if (t < p.strikeEndFraction) {
      // Spring: the hop arcs up and lands as the lunge and the hit pitch
      // arrive together (accelerating, like a slam).
      const k =
        (t - p.windupEndFraction) / (p.strikeEndFraction - p.windupEndFraction);
      const surge = k * k;
      pose.lift =
        -p.crouchDepth * (1 - k) + Math.sin(k * Math.PI) * p.hopHeight;
      pose.lunge = p.lungeDistance * surge;
      pose.bodyPitch = p.windupPitch + (p.strikePitch - p.windupPitch) * surge;
      pose.headPitch = p.strikeHeadPitch * surge;
      pose.windupBlend = 1 - k;
      pose.strikeBlend = k;
      return pose;
    }

    // Recover: everything settles back to neutral.
    const k = (t - p.strikeEndFraction) / (1 - p.strikeEndFraction);
    const settle = 1 - k;
    pose.lift = 0;
    pose.lunge = p.lungeDistance * settle;
    pose.bodyPitch = p.strikePitch * settle;
    pose.headPitch = p.strikeHeadPitch * settle;
    pose.windupBlend = 0;
    pose.strikeBlend = settle;
    return pose;
  }
}
