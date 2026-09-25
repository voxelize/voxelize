/**
 * Deterministic randomness for effects every client must draw alike.
 *
 * A cosmetic effect in a multiplayer world is only shared if every client
 * makes the same choices for it: which voxel sheds a particle, where in the
 * jitter box it starts, which palette colour it takes. `Math.random` makes a
 * different choice on every machine. These helpers turn shared inputs (voxel
 * coordinates, an entity id, a slot of a shared clock, an event sequence
 * number) into the same numbers everywhere, so the same inputs draw the same
 * effect on every screen.
 *
 * Everything here is integer math on 32-bit values (`Math.imul`, shifts), so
 * results are bit-identical across engines and platforms.
 */

/** A source of uniform numbers in [0, 1), like `Math.random`. */
export type RandomSource = () => number;

/**
 * A 32-bit hash of integers, for seeding. Order matters: `(1, 2)` and
 * `(2, 1)` hash apart. Non-integers are truncated toward zero, so pass voxel
 * coordinates or scaled integers, not raw positions.
 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/** A 32-bit hash of a string id (FNV-1a, then mixed). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return fmix32(h ^ text.length);
}

/**
 * mulberry32: a small, fast generator of numbers in [0, 1) from one 32-bit
 * seed. Its sequence is fixed by the seed, so two clients that seed alike
 * draw alike for as long as they draw in the same order.
 */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded {@link RandomSource}. The neutral name for {@link mulberry32};
 * seed it with {@link hashSeed} of whatever makes the effect unique.
 */
export function seededRandom(seed: number): RandomSource {
  return mulberry32(seed);
}

/**
 * One uniform number in [0, 1) from a seed, without building a generator:
 * for a single choice (a phase, a period, a rank) keyed on a seed.
 */
export function unitOf(seed: number): number {
  return fmix32((seed ^ 0x5bd1e995) >>> 0) / 4294967296;
}

/**
 * A stable phase in [0, period) for an id, so a looping animation (a bob,
 * a flicker, an idle beat) starts at the same point of its cycle on every
 * client instead of wherever each one happened to create it.
 */
export function hashPhase(
  key: string | number,
  period: number = Math.PI * 2,
): number {
  const seed = typeof key === "number" ? hashSeed(key) : hashString(key);
  return unitOf(seed) * period;
}

/** An integer in [min, max] (inclusive) from a random source. */
export function randomInt(
  random: RandomSource,
  min: number,
  max: number,
): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** murmur3's 32-bit finalizer: every input bit reaches every output bit. */
function fmix32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
