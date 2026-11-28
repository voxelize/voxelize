import { describe, expect, it } from "vitest";

import { VoicePlayout } from "./playout";

const FRAME = 0.02;

describe("VoicePlayout", () => {
  it("starts an utterance one delay ahead and butts each frame to the last", () => {
    const playout = new VoicePlayout({ minDelay: 0.06 });
    expect(playout.schedule(10, FRAME)).toBeCloseTo(10.06, 9);
    expect(playout.schedule(10.02, FRAME)).toBeCloseTo(10.08, 9);
    expect(playout.schedule(10.04, FRAME)).toBeCloseTo(10.1, 9);
    expect(playout.underruns).toBe(0);
  });

  it("absorbs a burst: frames that arrive together still play end to end", () => {
    const playout = new VoicePlayout({ minDelay: 0.06 });
    const starts = [0, 1, 2, 3].map(() => playout.schedule(5, FRAME));
    expect(starts.map((s) => Number(s!.toFixed(3)))).toEqual([
      5.06, 5.08, 5.1, 5.12,
    ]);
  });

  it("grows the delay when the queue runs dry mid-utterance", () => {
    const playout = new VoicePlayout({ minDelay: 0.06, maxDelay: 0.24 });
    playout.schedule(1, FRAME); // plays 1.06..1.08
    // The next frame is 100 ms late: the queue ran dry at 1.08.
    const start = playout.schedule(1.1, FRAME)!;
    expect(playout.underruns).toBe(1);
    expect(playout.currentDelay).toBeCloseTo(0.1, 9);
    expect(start).toBeCloseTo(1.2, 9);
  });

  it("never grows the delay past its cap", () => {
    const playout = new VoicePlayout({ minDelay: 0.06, maxDelay: 0.24 });
    let now = 0;
    for (let i = 0; i < 20; i++) {
      playout.schedule(now, FRAME);
      now += playout.currentDelay + FRAME + 0.05;
    }
    expect(playout.currentDelay).toBe(0.24);
  });

  it("does not count the pause between two utterances as an underrun", () => {
    const playout = new VoicePlayout({ minDelay: 0.06 });
    playout.schedule(1, FRAME);
    expect(playout.schedule(3, FRAME)).toBeCloseTo(3.06, 9);
    expect(playout.underruns).toBe(0);
    expect(playout.currentDelay).toBe(0.06);
  });

  it("eases the delay back down once things have been calm", () => {
    const playout = new VoicePlayout({
      minDelay: 0.06,
      maxDelay: 0.24,
      calmBeforeShrink: 8,
    });
    playout.schedule(1, FRAME);
    playout.schedule(1.1, FRAME); // underrun: 0.1
    // A new utterance soon after keeps the grown delay.
    playout.schedule(3, FRAME);
    expect(playout.currentDelay).toBeCloseTo(0.1, 9);
    // One after a calm stretch starts lower, and never under the minimum.
    playout.schedule(12, FRAME);
    expect(playout.currentDelay).toBeCloseTo(0.08, 9);
    playout.schedule(30, FRAME);
    playout.schedule(60, FRAME);
    playout.schedule(90, FRAME);
    expect(playout.currentDelay).toBe(0.06);
  });

  it("leaves silence for lost frames, but never more than a few", () => {
    const playout = new VoicePlayout({ minDelay: 0.06 });
    playout.schedule(1, FRAME); // ends 1.08
    expect(playout.schedule(1.02, FRAME, 2)).toBeCloseTo(1.12, 9);
    expect(playout.schedule(1.04, FRAME, 50)).toBeCloseTo(1.2, 9);
  });

  it("drops frames when a burst puts the queue too far ahead of the clock", () => {
    const playout = new VoicePlayout({
      minDelay: 0.06,
      maxDelay: 0.24,
      maxLead: 0.1,
    });
    // Forty frames (0.8 s of sound) land at once after a stall.
    const starts = Array.from({ length: 40 }, () => playout.schedule(2, FRAME));
    const played = starts.filter((start) => start !== null) as number[];
    expect(played.length).toBeLessThan(12);
    expect(playout.droppedFrames).toBe(40 - played.length);
    expect(Math.max(...played) - 2).toBeLessThanOrEqual(0.06 + 0.1 + 1e-9);
    // Once the clock catches up, frames play again.
    expect(playout.schedule(2.3, FRAME)).not.toBeNull();
  });

  it("starts fresh after a reset", () => {
    const playout = new VoicePlayout({ minDelay: 0.06 });
    playout.schedule(1, FRAME);
    playout.reset();
    expect(playout.schedule(1.01, FRAME)).toBeCloseTo(1.07, 9);
    expect(playout.underruns).toBe(0);
  });
});
