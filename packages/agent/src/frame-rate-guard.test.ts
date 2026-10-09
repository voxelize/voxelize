import { describe, expect, it } from "vitest";

import type { FrameRateDrawRecord } from "./bridge";
import {
  CappedFrameRateError,
  MIN_DRAWN_FRAME_SHARE,
  assertUncappedWindow,
} from "./frame-rate-guard";

const uncapped = (
  overrides: Partial<FrameRateDrawRecord> = {},
): FrameRateDrawRecord => ({
  isReported: true,
  intervalAtStartMs: null,
  intervalAtEndMs: null,
  cappedFrames: 0,
  maxIntervalMs: null,
  drawnFrames: 600,
  ...overrides,
});

const refusal = (record: FrameRateDrawRecord, frameCount: number) => {
  try {
    assertUncappedWindow(record, frameCount);
  } catch (error) {
    return error;
  }
  return null;
};

describe("assertUncappedWindow", () => {
  it("passes a window that ran uncapped and drew every frame", () => {
    expect(refusal(uncapped(), 600)).toBeNull();
  });

  it("refuses a window with any capped frame, warmup included", () => {
    const record = uncapped({
      intervalAtStartMs: 500,
      cappedFrames: 1,
      maxIntervalMs: 500,
    });
    const error = refusal(record, 600);
    expect(error).toBeInstanceOf(CappedFrameRateError);
    expect((error as CappedFrameRateError).record).toBe(record);
    expect((error as Error).message).toMatch(/draw cap was on for 1 frame/);
    expect((error as Error).message).toMatch(/every 500ms at its widest/);
  });

  it("refuses a cap that landed mid-window and was gone by the end", () => {
    const error = refusal(
      uncapped({ cappedFrames: 37, maxIntervalMs: 5000 }),
      600,
    );
    expect(error).toBeInstanceOf(CappedFrameRateError);
    expect((error as Error).message).toMatch(/uncapped at the start/);
  });

  it("refuses a window where the host drew far fewer frames than rAF ran", () => {
    // A 2fps drawing cadence under a loop rAF still runs at 60fps.
    const error = refusal(uncapped({ drawnFrames: 20 }), 600);
    expect(error).toBeInstanceOf(CappedFrameRateError);
    expect((error as Error).message).toMatch(/drew 20 of the 600 frames/);
  });

  it("allows the window's edges and an occasional skipped draw", () => {
    const frameCount = 600;
    const atTheBound = Math.floor(frameCount * MIN_DRAWN_FRAME_SHARE) - 2;
    expect(
      refusal(uncapped({ drawnFrames: atTheBound }), frameCount),
    ).toBeNull();
    expect(
      refusal(uncapped({ drawnFrames: atTheBound - 1 }), frameCount),
    ).toBeInstanceOf(CappedFrameRateError);
  });

  it("judges only the cap when the host does not count its draws", () => {
    expect(refusal(uncapped({ drawnFrames: null }), 600)).toBeNull();
    expect(
      refusal(
        uncapped({ drawnFrames: null, cappedFrames: 3, maxIntervalMs: 500 }),
        600,
      ),
    ).toBeInstanceOf(CappedFrameRateError);
  });

  it("keeps an honestly slow page's number: slow is not capped", () => {
    // Three frames a second, every one drawn: a struggling page, reported.
    expect(refusal(uncapped({ drawnFrames: 30 }), 30)).toBeNull();
  });
});
