/**
 * The clock chunk shaders animate on: water waves and ripples, caustics,
 * foliage sway, light flicker, and anything a game binds to the same `time`
 * uniform.
 *
 * It follows the world's shared clock rather than the page's uptime, so two
 * players looking at the same shore see the same wave at the same moment.
 * Three things make that safe to feed a GPU:
 *
 * - It is slewed, not snapped. The shared clock corrects itself when the
 *   server's STATS disagree; a shader that jumped with it would stutter every
 *   wave on screen. Small corrections are absorbed by running slightly fast or
 *   slow; only a real jump (a `/time` change, a long stall) is taken at once.
 * - It is wrapped. A float32 uniform in milliseconds holds millisecond
 *   precision only up to 2^24 ms (about 4.6 hours), and a shared clock can be
 *   days in. Every client wraps at the same shared moment, so the one pop per
 *   period happens everywhere at once instead of each client drifting.
 * - A frozen shared clock (a world that does not tick time) falls back to the
 *   wall clock through `World.sharedClock`, which is still shared.
 */

/** Wrap period of the shader clock, in seconds: 2^14, under 2^24 ms. */
export const SHADER_CLOCK_WRAP_SECONDS = 16384;

/** Corrections above this are taken at once; smaller ones are slewed. */
export const SHADER_CLOCK_SNAP_SECONDS = 1;

/**
 * Seconds of correction absorbed per second of play, as a fraction: at 0.1
 * a 0.1s correction plays out over a second, with the animation running 10%
 * fast or slow meanwhile.
 */
export const SHADER_CLOCK_SLEW_RATE = 0.1;

/**
 * A frame's advance is taken whole up to the snap: the shared clock is the
 * truth, so a slow frame (a 2 fps background tab) keeps pace with it rather
 * than falling behind and snapping back every few frames. A longer stall
 * snaps.
 */
export const SHADER_CLOCK_MAX_STEP_SECONDS = SHADER_CLOCK_SNAP_SECONDS;

export class ShaderClock {
  /**
   * Whether the clock follows the shared clock. Off, it runs on local
   * frame time from zero like the old page-uptime clock: an A/B switch.
   */
  isShared = true;

  private unwrapped = Number.NaN;

  /** Seconds, unwrapped: what the clock reads now. */
  get seconds(): number {
    return Number.isFinite(this.unwrapped) ? this.unwrapped : 0;
  }

  /** Seconds in `[0, SHADER_CLOCK_WRAP_SECONDS)`: what the uniform holds. */
  get wrappedSeconds(): number {
    return wrapShaderSeconds(this.seconds);
  }

  /**
   * Advances by one frame toward `shared`, the world's shared clock, and
   * returns the unwrapped reading.
   */
  advance(shared: number, deltaSeconds: number): number {
    const step = Math.min(
      Math.max(deltaSeconds, 0),
      SHADER_CLOCK_MAX_STEP_SECONDS,
    );
    if (!this.isShared || !Number.isFinite(shared)) {
      this.unwrapped =
        (Number.isFinite(this.unwrapped) ? this.unwrapped : 0) + step;
      return this.unwrapped;
    }
    this.unwrapped = slewShaderClock(this.unwrapped, shared, step);
    return this.unwrapped;
  }
}

/**
 * One frame of the slew: `current` advanced by `step` and pulled toward
 * `target` by at most `SHADER_CLOCK_SLEW_RATE * step`, or set to `target`
 * when it is unset or too far off to slew.
 */
export function slewShaderClock(
  current: number,
  target: number,
  step: number,
): number {
  if (!Number.isFinite(current)) return target;
  const advanced = current + step;
  const error = target - advanced;
  if (Math.abs(error) > SHADER_CLOCK_SNAP_SECONDS) return target;
  const limit = SHADER_CLOCK_SLEW_RATE * step;
  return advanced + Math.min(limit, Math.max(-limit, error));
}

/** A clock reading wrapped into `[0, SHADER_CLOCK_WRAP_SECONDS)`. */
export function wrapShaderSeconds(seconds: number): number {
  const wrapped = seconds % SHADER_CLOCK_WRAP_SECONDS;
  return wrapped < 0 ? wrapped + SHADER_CLOCK_WRAP_SECONDS : wrapped;
}

/** Radians a second the wind's heading turns. */
const WIND_TURN_RATE = 0.01;
/** A slower second heading that bends the first, and its share. */
const WIND_MEANDER_RATE = 0.003;
const WIND_MEANDER_SHARE = 0.35;
/** Units a second the sway noise scrolls at wind speed 1. */
const WIND_OFFSET_UNITS_PER_SECOND = 0.05;

/**
 * The wind at a moment of the shader clock: its heading, and the distance
 * the sway noise has scrolled. The scroll is the integral of the heading,
 * which has a closed form here, so it is a function of the clock alone and
 * every client scrolls to the same place without accumulating anything.
 * `seconds` is the unwrapped clock, so the wrap never jolts the wind.
 */
export function windAt(
  seconds: number,
  speed: number,
  direction: { set(x: number, y: number): unknown },
  offset: { set(x: number, y: number): unknown },
): void {
  // Both headings are periodic, so reducing the clock to their periods
  // first keeps the trigonometry exact however long the world has run.
  const turn = (seconds % ((Math.PI * 2) / WIND_TURN_RATE)) * WIND_TURN_RATE;
  const meander =
    (seconds % ((Math.PI * 2) / WIND_MEANDER_RATE)) * WIND_MEANDER_RATE;
  const dx = Math.cos(turn) + WIND_MEANDER_SHARE * Math.cos(meander);
  const dy = Math.sin(turn) + WIND_MEANDER_SHARE * Math.sin(meander);
  const length = Math.hypot(dx, dy) || 1;
  direction.set(dx / length, dy / length);
  const scale = speed * WIND_OFFSET_UNITS_PER_SECOND;
  offset.set(
    scale *
      (Math.sin(turn) / WIND_TURN_RATE +
        (WIND_MEANDER_SHARE * Math.sin(meander)) / WIND_MEANDER_RATE),
    scale *
      ((1 - Math.cos(turn)) / WIND_TURN_RATE +
        (WIND_MEANDER_SHARE * (1 - Math.cos(meander))) / WIND_MEANDER_RATE),
  );
}
