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

/**
 * Say which refresh the frame now being drawn is for: the timestamp the
 * browser passed to the animation-frame callback. `null` once it is drawn.
 */
export function setFrameTime(timestamp: number | null): void {
  frameTime = timestamp;
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
