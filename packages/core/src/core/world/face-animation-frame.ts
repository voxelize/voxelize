/**
 * Which frame an animated block face shows at a moment of a clock.
 *
 * A face animation is a loop of keyframes, each held for its own duration
 * and, when the animation fades, followed by a short crossfade into the
 * next. Read off a clock every client shares, two players looking at the
 * same water see the same frame; timers started at each page's atlas load
 * put every client somewhere else in the loop.
 */

/** One crossfade step lasts a 60Hz frame, the rate fades were tuned at. */
export const FACE_ANIMATION_FADE_STEP_MS = 1000 / 60;

export type FaceAnimationFrame = {
  /** The keyframe on screen, or fading out. */
  index: number;
  /** The keyframe fading in; equal to `index` while holding. */
  next: number;
  /**
   * 0 while holding; 1..fadeFrames through the crossfade, where the next
   * keyframe shows at `fadeStep / (fadeFrames + 1)`.
   */
  fadeStep: number;
};

/**
 * The frame at `timeMs` of a loop whose keyframes hold for `durationsMs`,
 * each followed by `fadeFrames` crossfade steps. Pure, so the same time
 * gives the same frame on every client.
 */
export function faceAnimationFrameAt(
  durationsMs: readonly number[],
  fadeFrames: number,
  timeMs: number,
  out: FaceAnimationFrame = { index: 0, next: 0, fadeStep: 0 },
): FaceAnimationFrame {
  const count = durationsMs.length;
  const fadeMs = Math.max(0, fadeFrames) * FACE_ANIMATION_FADE_STEP_MS;
  let cycle = 0;
  for (let i = 0; i < count; i += 1)
    cycle += Math.max(0, durationsMs[i]) + fadeMs;
  out.index = 0;
  out.next = count > 1 ? 1 % count : 0;
  out.fadeStep = 0;
  if (count === 0 || cycle <= 0 || !Number.isFinite(timeMs)) {
    out.next = 0;
    return out;
  }
  let t = timeMs % cycle;
  if (t < 0) t += cycle;
  for (let i = 0; i < count; i += 1) {
    const hold = Math.max(0, durationsMs[i]);
    out.index = i;
    out.next = (i + 1) % count;
    if (t < hold) {
      out.next = i;
      out.fadeStep = 0;
      return out;
    }
    t -= hold;
    if (t < fadeMs) {
      out.fadeStep = Math.min(
        fadeFrames,
        1 + Math.floor(t / FACE_ANIMATION_FADE_STEP_MS),
      );
      return out;
    }
    t -= fadeMs;
  }
  // Rounding at the very end of the cycle: the last keyframe's fade ends.
  out.index = count - 1;
  out.next = 0;
  out.fadeStep = Math.max(0, fadeFrames);
  return out;
}
