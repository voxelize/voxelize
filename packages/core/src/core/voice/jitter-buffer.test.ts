import { describe, expect, it } from "vitest";

import { VoiceJitterBuffer } from "./jitter-buffer";

const seqs = (frames: { seq: number }[]) => frames.map((frame) => frame.seq);

describe("VoiceJitterBuffer", () => {
  it("passes an in-order stream straight through", () => {
    const buffer = new VoiceJitterBuffer<string>();
    buffer.push(10, "a", 0);
    expect(buffer.drain(0)).toEqual([{ seq: 10, frame: "a", lostBefore: 0 }]);
    buffer.push(11, "b", 20);
    buffer.push(12, "c", 20);
    expect(seqs(buffer.drain(20))).toEqual([11, 12]);
    expect(buffer.size).toBe(0);
  });

  it("holds a frame that overtook the one before it, then releases both in order", () => {
    const buffer = new VoiceJitterBuffer<string>({ maxHoldMs: 60 });
    buffer.push(1, "a", 0);
    buffer.drain(0);
    buffer.push(3, "c", 20);
    expect(buffer.drain(20)).toEqual([]);
    buffer.push(2, "b", 30);
    expect(buffer.drain(30)).toEqual([
      { seq: 2, frame: "b", lostBefore: 0 },
      { seq: 3, frame: "c", lostBefore: 0 },
    ]);
    expect(buffer.lostFrames).toBe(0);
  });

  it("gives a missing frame up after the hold and says how many were lost", () => {
    const buffer = new VoiceJitterBuffer<string>({ maxHoldMs: 60 });
    buffer.push(1, "a", 0);
    buffer.drain(0);
    buffer.push(4, "d", 20);
    expect(buffer.drain(79)).toEqual([]);
    expect(buffer.drain(80)).toEqual([{ seq: 4, frame: "d", lostBefore: 2 }]);
    expect(buffer.lostFrames).toBe(2);
  });

  it("drops a frame that arrives after its place was played", () => {
    const buffer = new VoiceJitterBuffer<string>({ maxHoldMs: 60 });
    buffer.push(1, "a", 0);
    buffer.push(3, "c", 0);
    buffer.drain(100);
    buffer.push(2, "late", 110);
    expect(buffer.drain(110)).toEqual([]);
    expect(buffer.lateFrames).toBe(1);
    buffer.push(4, "d", 120);
    expect(seqs(buffer.drain(120))).toEqual([4]);
  });

  it("plays a repeated frame once", () => {
    const buffer = new VoiceJitterBuffer<string>();
    buffer.push(1, "a", 0);
    buffer.push(1, "again", 0);
    expect(buffer.drain(0)).toEqual([{ seq: 1, frame: "a", lostBefore: 0 }]);
  });

  it("does not wait on a gap once too many frames pile up behind it", () => {
    const buffer = new VoiceJitterBuffer<number>({
      maxHoldMs: 10_000,
      maxFrames: 4,
    });
    buffer.push(0, 0, 0);
    buffer.drain(0);
    for (let seq = 2; seq <= 6; seq++) buffer.push(seq, seq, 1);
    const out = buffer.drain(1);
    expect(seqs(out)).toEqual([2, 3, 4, 5, 6]);
    expect(out[0].lostBefore).toBe(1);
  });

  it("counts on across the 32-bit wrap", () => {
    const buffer = new VoiceJitterBuffer<string>();
    buffer.push(0xffffffff, "last", 0);
    buffer.push(0, "first", 0);
    buffer.push(1, "second", 0);
    expect(seqs(buffer.drain(0))).toEqual([0xffffffff, 0, 1]);
  });

  it("starts over when the speaker's counter jumps", () => {
    const buffer = new VoiceJitterBuffer<string>();
    buffer.push(50_000, "old", 0);
    buffer.drain(0);
    // A reloaded client counts from zero again: not fifty thousand late frames.
    buffer.push(0, "new", 20);
    expect(buffer.drain(20)).toEqual([{ seq: 0, frame: "new", lostBefore: 0 }]);
    expect(buffer.lateFrames).toBe(0);
  });

  it("hands over what it still holds when the utterance ends", () => {
    const buffer = new VoiceJitterBuffer<string>({ maxHoldMs: 60 });
    buffer.push(1, "a", 0);
    buffer.drain(0);
    buffer.push(4, "d", 10);
    buffer.push(3, "c", 12);
    expect(buffer.drain(12)).toEqual([]);
    expect(buffer.flush()).toEqual([
      { seq: 3, frame: "c", lostBefore: 1 },
      { seq: 4, frame: "d", lostBefore: 0 },
    ]);
    expect(buffer.size).toBe(0);
    // The next utterance may start anywhere.
    buffer.push(2, "again", 20);
    expect(seqs(buffer.drain(20))).toEqual([2]);
  });

  it("forgets its place on reset", () => {
    const buffer = new VoiceJitterBuffer<string>();
    buffer.push(7, "a", 0);
    buffer.reset();
    expect(buffer.drain(0)).toEqual([]);
    buffer.push(3, "b", 0);
    expect(seqs(buffer.drain(0))).toEqual([3]);
  });
});
