/**
 * The time of the frame being drawn.
 *
 * A browser issues each animation frame for one refresh of the screen and
 * hands the callback that refresh's timestamp. The callback itself can start
 * late: a collection, a timer or a burst of network messages may hold the
 * main thread first. The frame is still drawn for the same refresh, so what
 * it shows has to be stepped by the time between refreshes, not by the time
 * between the moments the callbacks got to run. Stepped by the wall clock, a
 * frame that began 10 ms late moves the world a frame and a half, and the
 * next one half a frame: a stutter on a screen that missed no refresh.
 *
 * The game loop sets the frame's time once, first thing in its callback, and
 * clears it when the frame is drawn. Every engine timer that steps motion
 * reads {@link frameNow}: the frame's time inside a frame, the wall clock
 * anywhere else (a hidden tab's worker-driven updates, a test).
 *
 * ```ts
 * function animate(timestamp: number) {
 *   requestAnimationFrame(animate);
 *   setFrameTime(timestamp);
 *   controls.update();
 *   world.update(controls.position, controls.getDirection());
 *   renderer.render(world, camera);
 *   setFrameTime(null);
 * }
 * ```
 */
let frameTime: number | null = null;

/** The newest frame's own time: kept after the frame is drawn. */
let issuedAt = Number.NaN;
/** The gaps between the last frames' times, newest overwriting oldest. */
const GAPS_KEPT = 90;
const gaps = new Float64Array(GAPS_KEPT);
let gapsHeld = 0;
let gapAt = 0;
let refreshMs = 0;
let paceMs = 0;
/** A gap shorter than this is no display's refresh: the page is unpaced. */
const SHORTEST_REFRESH_MS = 3;
/** A gap longer than this is a pause (a hidden tab), not a slow frame. */
const LONGEST_GAP_MS = 250;
/**
 * The share of a refresh that budgeted work may plan to fill. The rest is
 * left for what nobody schedules: worker results, network messages, input.
 */
const PLANNED_SHARE = 0.85;

/**
 * Say which refresh the frame now being drawn is for: the timestamp the
 * browser passed to the animation-frame callback. `null` once it is drawn.
 */
export function setFrameTime(timestamp: number | null): void {
  frameTime = timestamp;
  if (timestamp === null) return;
  const gap = timestamp - issuedAt;
  issuedAt = timestamp;
  if (!(gap > 0) || gap > LONGEST_GAP_MS) return;
  gaps[gapAt] = gap;
  gapAt = (gapAt + 1) % GAPS_KEPT;
  if (gapsHeld < GAPS_KEPT) gapsHeld += 1;
  // The display's refresh is the fastest pace frames have been issued at:
  // a page that misses refreshes is issued frames two or three apart, never
  // closer than one.
  let fastest = Infinity;
  let sum = 0;
  for (let i = 0; i < gapsHeld; i += 1) {
    if (gaps[i] < fastest) fastest = gaps[i];
    sum += gaps[i];
  }
  refreshMs = fastest >= SHORTEST_REFRESH_MS ? fastest : 0;
  paceMs = sum / gapsHeld;
}

/**
 * The display's refresh interval in ms as the frames show it, or 0 while it
 * is not known: no host has called {@link setFrameTime} twice yet, or the
 * page is not paced by a display.
 */
export function frameRefreshMs(): number {
  return refreshMs;
}

/**
 * The pace frames are really coming at: the mean gap between the last ones,
 * in ms, or 0 before two frames have been seen. Equal to
 * {@link frameRefreshMs} on a page that holds its display's refresh, longer
 * on one that does not.
 */
export function framePaceMs(): number {
  return paceMs;
}

/**
 * How many ms of main-thread work still fit before the frame after the
 * newest one is due, read at `now` (the wall clock). Work that can wait (a
 * backlog drained a slice a frame) asks this for its slice, so a frame that
 * began late or ran long gets a short one and the display's refresh is held
 * whatever else is going on.
 *
 * `null` when there is nothing to plan against: no host feeds the frame
 * clock, the page is unpaced, or frames have stopped (a hidden tab). The
 * caller then falls back to its own fixed allowance.
 */
export function frameRoomMs(now: number = performance.now()): number | null {
  if (refreshMs === 0) return null;
  const sinceIssued = now - issuedAt;
  if (!(sinceIssued >= 0) || sinceIssued > LONGEST_GAP_MS) return null;
  return refreshMs * PLANNED_SHARE - sinceIssued;
}

/** Forgets every frame seen. For tests. */
export function resetFrameClock(): void {
  frameTime = null;
  issuedAt = Number.NaN;
  gapsHeld = 0;
  gapAt = 0;
  refreshMs = 0;
  paceMs = 0;
}

/**
 * The time to step by: the frame's own time while one is being drawn, the
 * wall clock otherwise. Same clock as `performance.now()`.
 */
export function frameNow(): number {
  return frameTime ?? performance.now();
}

/**
 * A step in seconds from a timer fed by {@link frameNow}, never negative and
 * never longer than `maxSeconds`. A timer that last ticked on the wall clock
 * (outside a frame) can sit a little after the next frame's own time.
 */
export function frameStep(seconds: number, maxSeconds = Infinity): number {
  return Math.min(Math.max(seconds, 0), maxSeconds);
}
