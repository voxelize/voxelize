/**
 * Critically damped smoothing, solved exactly for any step length: a
 * second of easing comes out the same whether it is drawn as 30 frames or
 * 144, which a per-frame lerp (`x += (goal - x) * k`) never does. From
 * rest it approaches its goal without passing it.
 */

export type Spring = { value: number; velocity: number };

/**
 * (1 + x)·e^-x = 0.1 at this x: a critically damped spring released from
 * rest covers 90% of the way to its goal when ω·t reaches it.
 */
const NINETY_PERCENT = 3.88972;

/** Angular frequency for a spring that covers 90% of a change in `settle` seconds. */
export function settleOmega(settle: number): number {
  return NINETY_PERCENT / settle;
}

/**
 * `spring` advanced `dt` seconds toward `goal`, settling 90% of the way in
 * `settle` seconds. A `settle` of 0 (or less) snaps: no easing at all.
 */
export function dampTo(
  spring: Spring,
  goal: number,
  settle: number,
  dt: number,
): Spring {
  if (!(settle > 0)) return { value: goal, velocity: 0 };
  const omega = settleOmega(settle);
  const offset = spring.value - goal;
  const k = spring.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  return {
    value: goal + (offset + k * dt) * decay,
    velocity: (spring.velocity - omega * k * dt) * decay,
  };
}

/** Whether a spring is close enough to `goal`, and slow enough, to stop. */
export function isSettled(
  spring: Spring,
  goal: number,
  tolerance: number,
): boolean {
  return (
    Math.abs(spring.value - goal) <= tolerance &&
    Math.abs(spring.velocity) <= tolerance
  );
}

/** The middle value (mean of the middle two for an even count); null for none. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
