import type { FrameRateDrawRecord } from "./bridge";

/**
 * A frame-rate measurement times `requestAnimationFrame` callbacks. Every cap
 * a host puts on its drawing (the daemon's idle throttle, a slow cadence
 * while loading, a loop that stops while unfocused) skips draws without
 * slowing rAF, so a capped page still delivers rAF at full rate: measured
 * anyway it reports a smooth frame rate for frames that were never drawn.
 * That number is well-formed, in range, and a lie, so a capped window is
 * refused instead of reported.
 */
export class CappedFrameRateError extends Error {
  readonly record: FrameRateDrawRecord;

  constructor(message: string, record: FrameRateDrawRecord) {
    super(message);
    this.name = "CappedFrameRateError";
    this.record = record;
  }
}

/**
 * Below this share of rAF frames actually drawn, the host was skipping
 * draws. An uncapped loop draws on every frame it runs; the slack covers the
 * window's two edges and a frame a host occasionally skips on its own.
 */
export const MIN_DRAWN_FRAME_SHARE = 0.9;
const DRAWN_FRAME_EDGE_SLACK = 2;

/** Throws {@link CappedFrameRateError} unless the whole window ran uncapped. */
export function assertUncappedWindow(
  record: FrameRateDrawRecord,
  frameCount: number,
): void {
  if (record.cappedFrames > 0) {
    throw new CappedFrameRateError(
      `measureFrameRate refused: the page's draw cap was on for ${record.cappedFrames} ` +
        `frame(s) of the window (every ${record.maxIntervalMs}ms at its widest; ` +
        `${describeCap(record.intervalAtStartMs)} at the start, ${describeCap(record.intervalAtEndMs)} at the end). ` +
        "rAF keeps running under a cap, so the number would be the loop's cadence, " +
        "not frames drawn. Lift the cap and measure again.",
      record,
    );
  }
  if (record.drawnFrames === null) return;
  const required =
    Math.floor(frameCount * MIN_DRAWN_FRAME_SHARE) - DRAWN_FRAME_EDGE_SLACK;
  if (record.drawnFrames < required) {
    throw new CappedFrameRateError(
      `measureFrameRate refused: the page drew ${record.drawnFrames} of the ${frameCount} ` +
        "frames rAF delivered in the window. Its loop was skipping draws (a cap of its " +
        "own: a loading cadence, an unfocused window), so the number would not be its " +
        "frame rate.",
      record,
    );
  }
}

function describeCap(intervalMs: number | null): string {
  return intervalMs === null ? "uncapped" : `every ${intervalMs}ms`;
}
