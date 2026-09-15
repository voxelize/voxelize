/**
 * Fraction of the way a critically damped spring has left to travel is
 * `(1 + u) * e^-u` for `u = omega * t`. This is the `u` at which 5% remains,
 * so `omega = SETTLE_ROOT / settleTime` closes 95% of a step in `settleTime`.
 */
const SETTLE_ROOT = 4.744;

/**
 * Below this remaining offset (blocks) and speed (blocks per second) the
 * spring is parked at exactly zero instead of trailing an invisible tail
 * forever.
 */
const REST_OFFSET = 1e-4;
const REST_SPEED = 1e-3;

/**
 * Eases the eye over an auto-step.
 *
 * The rigid body climbs a step in a single physics tick. That is the right
 * thing for collision and for the position peers receive, but shown raw it
 * reads as a pop, and a per-frame lerp toward the new height is barely
 * better: it finishes in a handful of frames, runs faster on faster
 * monitors, and drags the horizontal axes along with it.
 *
 * This tracks how far the eye still trails the body vertically after such a
 * teleport and closes the gap with a critically damped spring: an S-curve
 * with no overshoot and continuous velocity at both ends, advanced in closed
 * form so the result is exact for any frame time. Consecutive steps on a
 * staircase simply add to the trailing offset and the spring carries them
 * all up in one motion.
 *
 * Usage: report each rise through {@link noteStep} as physics commits it,
 * call {@link absorbPending} at the moment the eye anchor is re-derived from
 * the body (so the anchor's jump and the counter-offset land in the same
 * frame), {@link advance} once per frame, and add {@link offset} to the
 * anchor's height.
 */
export class StepEyeSmoother {
  private _offset = 0;

  private _speed = 0;

  private _pendingRise = 0;

  /**
   * Vertical offset to add to the eye anchor this frame. Negative right after
   * a step up, decaying to zero.
   */
  get offset() {
    return this._offset;
  }

  /**
   * Whether the eye is still catching up with the body.
   */
  get isSettling() {
    return this._offset !== 0 || this._speed !== 0 || this._pendingRise !== 0;
  }

  /**
   * Physics moved the body vertically by `rise` blocks in one tick.
   */
  noteStep = (rise: number) => {
    if (!Number.isFinite(rise)) return;
    this._pendingRise += rise;
  };

  /**
   * The eye anchor has just been re-derived from the body, so every rise
   * noted since the previous anchor is now baked into it. Counter it here so
   * the eye holds its height this frame and glides up over the next ones.
   *
   * @param maxLag The farthest the eye may trail the anchor, in blocks. Steps
   *   stacking faster than the spring settles are clipped to this so the
   *   camera never sinks into the tread it stands on.
   */
  absorbPending = (maxLag: number) => {
    if (this._pendingRise === 0) return;

    this._offset -= this._pendingRise;
    this._pendingRise = 0;

    const cap = Math.max(0, maxLag);
    if (this._offset < -cap) this._offset = -cap;
    else if (this._offset > cap) this._offset = cap;
  };

  /**
   * Advance the spring by `dt` seconds.
   *
   * @param dt Frame time in seconds.
   * @param settleTime Seconds for the eye to close 95% of a step. `0` or less
   *   disables easing: the eye snaps to the anchor.
   */
  advance = (dt: number, settleTime: number) => {
    if (this._offset === 0 && this._speed === 0) return;

    if (settleTime <= 0) {
      this._offset = 0;
      this._speed = 0;
      return;
    }

    if (dt <= 0) return;

    // Closed-form critically damped response from state (x, v):
    //   x(t) = (x + (v + w x) t) e^-wt
    //   v(t) = (v - w (v + w x) t) e^-wt
    const omega = SETTLE_ROOT / settleTime;
    const decay = Math.exp(-omega * dt);
    const k = (this._speed + omega * this._offset) * dt;
    this._offset = (this._offset + k) * decay;
    this._speed = (this._speed - omega * k) * decay;

    if (
      Math.abs(this._offset) < REST_OFFSET &&
      Math.abs(this._speed) < REST_SPEED
    ) {
      this._offset = 0;
      this._speed = 0;
    }
  };

  /**
   * Drop any trailing offset and pending rises. Call when the anchor is
   * re-seated instantaneously (teleports, mount attach) so a step from the
   * old spot does not glide the eye at the new one.
   */
  reset = () => {
    this._offset = 0;
    this._speed = 0;
    this._pendingRise = 0;
  };
}
