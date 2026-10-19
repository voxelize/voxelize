/**
 * The world clock as the server keeps it: a time of day that wraps at
 * `timePerDay`, and a count of the days it has completed. Together they
 * unwrap into {@link elapsedSeconds}, the monotonic clock every client of a
 * world shares.
 */
export type WorldClock = {
  /** Days completed since the clock began. */
  day: number;
  /** Seconds into the current day, in `[0, timePerDay)`. */
  time: number;
};

/**
 * Advance the clock by `deltaSeconds`, wrapping the time of day and counting
 * the wrap as a completed day — the same step the server takes each tick.
 */
export const advanceWorldClock = (
  clock: WorldClock,
  deltaSeconds: number,
  timePerDay: number,
): WorldClock => {
  const next = clock.time + deltaSeconds;
  return {
    day: next >= timePerDay ? clock.day + 1 : clock.day,
    time: next % timePerDay,
  };
};

/** Seconds since the clock began: `day * timePerDay + time`. Never wraps. */
export const elapsedSeconds = (clock: WorldClock, timePerDay: number): number =>
  clock.day * timePerDay + clock.time;

/**
 * Whether the local clock has drifted from the server's by more than
 * `threshold` seconds. Judged on the unwrapped clocks: around midnight the
 * server and a client a few milliseconds apart sit on different days, and
 * their times of day alone would read as a whole day of drift.
 */
export const isClockDriftBeyond = (
  local: WorldClock,
  server: WorldClock,
  timePerDay: number,
  threshold: number,
): boolean =>
  Math.abs(
    elapsedSeconds(server, timePerDay) - elapsedSeconds(local, timePerDay),
  ) > threshold;

/**
 * The part of a frame's `deltaSeconds` the local clock still has to advance.
 * Server time arrives between frames and is taken as "now", so it already
 * covers the stretch of the frame before it landed; adding the whole delta
 * on top counted that stretch twice. At 60fps that is a few milliseconds,
 * but after a hitch or in a throttled tab it put the clock most of a frame
 * ahead, and the next STATS snapped it back: cloud drift and water lurched
 * forward and back twice a second. `syncedAtSeconds` is when the server
 * time was taken, on the same clock as `nowSeconds`; `-Infinity` when no
 * sync landed since the last frame.
 */
export const clockStepSince = (
  deltaSeconds: number,
  nowSeconds: number,
  syncedAtSeconds: number,
): number => Math.max(0, Math.min(deltaSeconds, nowSeconds - syncedAtSeconds));
