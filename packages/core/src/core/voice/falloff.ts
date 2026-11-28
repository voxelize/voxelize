/**
 * How a voice loses volume with distance.
 */
export type VoiceFalloff = {
  /** Up to this distance a voice plays at full volume. */
  fullVolumeDistance: number;

  /**
   * At and past this distance a voice is silent. A world's
   * `voiceRange` option: the server delivers a little further than this, so
   * the fade always finishes before delivery stops.
   */
  range: number;

  /**
   * Where the closing fade starts, as a fraction of `range`. Defaults to
   * {@link DEFAULT_VOICE_FADE_START}.
   */
  fadeStart?: number;
};

/** A voice is at full volume this close, in blocks. */
export const DEFAULT_VOICE_FULL_VOLUME_DISTANCE = 4;

/** The closing fade covers the outer half of the range. */
export const DEFAULT_VOICE_FADE_START = 0.5;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge1 <= edge0) return x < edge1 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The volume (0..1) of a voice `distance` away.
 *
 * Inside `fullVolumeDistance` it is 1. Past it the voice falls as the
 * inverse of the distance, the way a real one does, which is what makes far
 * sound far: half as loud at twice the distance. An inverse curve never
 * reaches zero, and a voice that stops at a hard edge sounds cut off, so
 * over the outer part of the range a smooth window takes it the rest of the
 * way: the gain and its slope both reach zero at `range`, with no step
 * anywhere along the way.
 */
export function voiceFalloffGain(
  distance: number,
  falloff: VoiceFalloff,
): number {
  const { range } = falloff;
  if (!Number.isFinite(distance) || !(range > 0)) return 0;
  if (distance >= range) return 0;
  const full = Math.min(Math.max(falloff.fullVolumeDistance, 0.01), range);
  if (distance <= full) return 1;
  const fadeStart = Math.max(
    full,
    range * (falloff.fadeStart ?? DEFAULT_VOICE_FADE_START),
  );
  const inverse = full / distance;
  const window = 1 - smoothstep(fadeStart, range, distance);
  return inverse * window;
}
