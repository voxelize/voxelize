/**
 * The weight shift of a walk, read off the legs themselves.
 *
 * Fed the stride each frame (half the difference between the two leg hinge
 * angles, positive with the right foot ahead), it answers with a small roll
 * toward the planted foot and a dip as the feet pass their widest. Because
 * it only watches the legs, it follows whatever gait drives them and fades
 * out by itself when they stop, hang level (sitting) or barely move (idle).
 */

/** Stride amplitude (radians) below which nothing sways. */
const STRIDE_FLOOR = 0.15;
/** Stride amplitude (radians) from which the sway is at full strength. */
const STRIDE_FULL = 0.5;
/** How fast the remembered stride size and pace let go, per second. */
const MEMORY_DECAY = 1.5;
/** How fast the output follows its target, per second. */
const FOLLOW_RATE = 18;
/** Leg speed (radians per second) past which a frame is a pose change, not a step. */
const PACE_CEILING = 30;

export class WalkSway {
  /**
   * Roll about the forward axis in radians, per unit of strength. Positive
   * leans the top of the body toward the left foot.
   */
  public roll = 0;

  /**
   * How far the body dips, from 0 (feet together) to 1 (feet at their
   * widest), per unit of strength.
   */
  public dip = 0;

  private amplitude = 0;
  private pace = 0;
  private lastStride = 0;

  /**
   * @param stride Half the difference of the leg hinge angles, right minus left.
   * @param delta Seconds since the last call.
   */
  update(stride: number, delta: number) {
    if (delta <= 0) return;

    const velocity = Math.min(
      PACE_CEILING,
      Math.max(-PACE_CEILING, (stride - this.lastStride) / delta),
    );
    this.lastStride = stride;

    const keep = Math.exp(-MEMORY_DECAY * delta);
    this.amplitude = Math.max(Math.abs(stride), this.amplitude * keep);
    this.pace = Math.max(Math.abs(velocity), this.pace * keep);

    const span = (this.amplitude - STRIDE_FLOOR) / (STRIDE_FULL - STRIDE_FLOOR);
    const t = Math.min(1, Math.max(0, span));
    const weight = t * t * (3 - 2 * t);

    let targetRoll = 0;
    let targetDip = 0;
    if (weight > 0 && this.pace > 0) {
      // The foot swinging forward is in the air, so the weight sits over the
      // other one, most of all as the legs cross (when they move fastest).
      // Legs that stop moving stop leaning, wherever they stopped.
      targetRoll = (velocity / this.pace) * weight;
      const reach = stride / this.amplitude;
      targetDip = reach * reach * weight;
    }

    const follow = 1 - Math.exp(-FOLLOW_RATE * delta);
    this.roll += (targetRoll - this.roll) * follow;
    this.dip += (targetDip - this.dip) * follow;
  }

  reset() {
    this.roll = 0;
    this.dip = 0;
    this.amplitude = 0;
    this.pace = 0;
    this.lastStride = 0;
  }
}
