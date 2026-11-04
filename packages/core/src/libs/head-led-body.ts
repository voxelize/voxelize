/**
 * How far a look may stray from the body before the body turns, how fast it
 * turns, and how close to the look a standing body settles.
 */
export type HeadLedBodyOptions = {
  /** Radians the look may sit off the body before a standing body turns. */
  reach: number;
  /** Radians per second a standing body turns to catch its look up. */
  turnRate: number;
  /** Radians off the look a standing body's turn ends at. */
  settle: number;
};

export const defaultHeadLedBodyOptions: HeadLedBodyOptions = {
  reach: 0.75,
  turnRate: 2.4,
  settle: 0.12,
};

/** Above this horizontal speed (blocks per second) a body walks. */
const WALK_SPEED = 0.4;
/** A look this far off its travel (radians) reads as backing away. */
const BACKPEDAL = 2.3;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A body whose head leads it. A standing body keeps its heading while its
 * look stays within `reach` and turns only once the look strays past it,
 * then until it faces the look within `settle`; the head covers the rest. A
 * walking body faces where it travels, turned only as far toward its look as
 * keeps the look within `reach`. Yaws are `atan2(dx, dz)` of a heading.
 */
export class HeadLedBody {
  /** The body's yaw. */
  public yaw = 0;

  private turning = false;
  private placed = false;
  private hasSample = false;
  private sampleX = 0;
  private sampleZ = 0;
  private vx = 0;
  private vz = 0;

  constructor(public options: HeadLedBodyOptions = defaultHeadLedBodyOptions) {}

  /** The look's yaw minus the body's, wrapped to [-pi, pi]. */
  offset(lookYaw: number) {
    return wrap(lookYaw - this.yaw);
  }

  /** Face `yaw` at once, with no turn in progress. */
  snap(yaw: number) {
    this.yaw = yaw;
    this.turning = false;
    this.placed = true;
  }

  /**
   * Advance the body one frame toward `lookYaw` from where it stands now
   * (`x`, `z`, the streamed position), and return its yaw.
   */
  update(lookYaw: number, x: number, z: number, delta: number) {
    if (!this.placed) this.snap(lookYaw);
    const dt = Math.max(delta, 1e-3);
    if (this.hasSample) {
      // A low-passed velocity: streamed positions step at the network rate,
      // so a single frame's step is noise.
      const k = 1 - Math.exp(-dt * 4);
      this.vx += ((x - this.sampleX) / dt - this.vx) * k;
      this.vz += ((z - this.sampleZ) / dt - this.vz) * k;
    }
    this.sampleX = x;
    this.sampleZ = z;
    this.hasSample = true;

    const { reach, turnRate, settle } = this.options;
    if (Math.hypot(this.vx, this.vz) > WALK_SPEED) {
      let travel = Math.atan2(this.vx, this.vz);
      // Backing away from what it watches, it keeps its face to it.
      if (Math.abs(wrap(lookYaw - travel)) > BACKPEDAL) travel += Math.PI;
      const lean = Math.max(-reach, Math.min(reach, wrap(lookYaw - travel)));
      const want = wrap(lookYaw - lean);
      const gap = wrap(want - this.yaw);
      this.yaw = wrap(
        this.yaw + Math.sign(gap) * Math.min(Math.abs(gap), turnRate * 2 * dt),
      );
      this.turning = false;
      return this.yaw;
    }

    const gap = wrap(lookYaw - this.yaw);
    if (Math.abs(gap) > reach) this.turning = true;
    if (this.turning) {
      const step = Math.min(Math.abs(gap), turnRate * dt);
      this.yaw = wrap(this.yaw + Math.sign(gap) * step);
      if (Math.abs(gap) - step <= settle) this.turning = false;
    }
    return this.yaw;
  }
}
