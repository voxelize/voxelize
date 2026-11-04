import { shortestYawDelta } from "./yaw";

/**
 * A critically damped spring on one angle, stepped by real elapsed time.
 *
 * A per-frame fraction (`yaw += diff * 0.2`) starts every turn at its top
 * speed, so a head or body whips the moment its target changes, and it runs
 * faster at higher frame rates. The spring starts from rest, speeds up,
 * then settles without overshooting: a head turn that reads as a decision
 * rather than a snap. `omega` sets the pace: about `4.7 / omega` seconds to
 * close 95% of a turn, with a peak speed of `turn * omega / e`.
 */
export class AngleSpring {
  /** Radians per second. */
  public velocity = 0;
  private at = 0;

  constructor(
    public omega: number,
    /** Wrap the goal the short way round (yaws); off for pitches. */
    private readonly wraps = true,
  ) {}

  /** Seconds since the last step, from the clock, bounded for a stall. */
  private elapsed(now: number) {
    const dt = this.at === 0 ? 1 / 60 : (now - this.at) / 1000;
    this.at = now;
    return Math.min(0.1, Math.max(0, dt));
  }

  /** Advance `current` toward `target` and return where it is now. */
  step(current: number, target: number, now = performance.now()) {
    const dt = this.elapsed(now);
    const goal = this.wraps
      ? current + shortestYawDelta(current, target)
      : target;
    const omega = this.omega;
    const offset = current - goal;
    const decay = Math.exp(-omega * dt);
    const pull = (this.velocity + omega * offset) * dt;
    this.velocity = (this.velocity - omega * pull) * decay;
    return goal + (offset + pull) * decay;
  }

  /** Forget the motion (a teleport, a respawn, a held pose). */
  stop() {
    this.velocity = 0;
  }
}

/** A head's turn and nod springs, for `computeHeadLook`. */
export class HeadLookMotion {
  public readonly yaw: AngleSpring;
  public readonly pitch: AngleSpring;

  /** `omega` 13 turns a head 60 degrees 90% of the way in about 0.3 s,
   *  peaking near 290 degrees a second: lively, never a snap. */
  constructor(omega = 13) {
    this.yaw = new AngleSpring(omega);
    this.pitch = new AngleSpring(omega, false);
  }
}
