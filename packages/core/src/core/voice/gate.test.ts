import { describe, expect, it } from "vitest";

import { VoiceGate } from "./gate";

const FRAME_MS = 20;

/** Run `levels` through a gate, a frame every 20 ms, and say which were sent. */
const run = (gate: VoiceGate, levels: number[], startMs = 0): boolean[] =>
  levels.map((level, i) => gate.step(level, startMs + i * FRAME_MS).isOpen);

describe("VoiceGate, push-to-talk", () => {
  it("sends only while the key is held, whatever the level", () => {
    const gate = new VoiceGate({ activation: "push-to-talk", releaseMs: 0 });
    expect(run(gate, [0.9, 0.9])).toEqual([false, false]);
    gate.isKeyHeld = true;
    expect(run(gate, [0, 0.9], 40)).toEqual([true, true]);
    gate.isKeyHeld = false;
    expect(run(gate, [0.9], 80)).toEqual([false]);
  });

  it("keeps sending for the release tail after the key comes up", () => {
    const gate = new VoiceGate({ activation: "push-to-talk", releaseMs: 150 });
    gate.isKeyHeld = true;
    gate.step(0.5, 0);
    gate.isKeyHeld = false;
    // Frames at 20, 40, ... 180 ms: the release is seen at 20 ms, so the
    // tail runs to 170 ms.
    const sent = run(gate, Array(9).fill(0.5), 20);
    expect(sent).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("reports the frame it opens on and the frame it closes on", () => {
    const gate = new VoiceGate({ activation: "push-to-talk", releaseMs: 0 });
    gate.isKeyHeld = true;
    expect(gate.step(0, 0)).toEqual({
      isOpen: true,
      didOpen: true,
      didClose: false,
    });
    expect(gate.step(0, 20).didOpen).toBe(false);
    gate.isKeyHeld = false;
    expect(gate.step(0, 40)).toEqual({
      isOpen: false,
      didOpen: false,
      didClose: true,
    });
    expect(gate.step(0, 60).didClose).toBe(false);
  });
});

describe("VoiceGate, open mic", () => {
  const open = () =>
    new VoiceGate({ activation: "open-mic", threshold: 0.4, holdMs: 100 });

  it("opens on a frame over the threshold and not under it", () => {
    const gate = open();
    expect(run(gate, [0.1, 0.39, 0.4])).toEqual([false, false, true]);
  });

  it("holds through the dips between words", () => {
    const gate = open();
    // Loud, then 80 ms under the threshold, then loud again: never closes.
    expect(run(gate, [0.6, 0.1, 0.1, 0.1, 0.1, 0.6])).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("closes once the silence outlasts the hold", () => {
    const gate = open();
    const sent = run(gate, [0.6, 0, 0, 0, 0, 0, 0]);
    // Loud at 0 ms; open through 80 ms; 100 ms of silence closes it.
    expect(sent).toEqual([true, true, true, true, true, false, false]);
  });

  it("does not chatter on a level hovering at the threshold", () => {
    const gate = new VoiceGate({
      activation: "open-mic",
      threshold: 0.4,
      holdMs: 0,
    });
    expect(run(gate, [0.41, 0.38, 0.41, 0.37, 0.3])).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("ignores the talk key", () => {
    const gate = open();
    gate.isKeyHeld = true;
    expect(run(gate, [0.1])).toEqual([false]);
  });
});

describe("VoiceGate, mute and test", () => {
  it("sends nothing while muted, key or level regardless", () => {
    const ptt = new VoiceGate({ activation: "push-to-talk" });
    ptt.isKeyHeld = true;
    ptt.isMuted = true;
    expect(run(ptt, [0.9, 0.9])).toEqual([false, false]);

    const mic = new VoiceGate({ activation: "open-mic", threshold: 0.2 });
    mic.isMuted = true;
    expect(run(mic, [0.9])).toEqual([false]);
  });

  it("closes the frame the mute lands, with no tail", () => {
    const gate = new VoiceGate({ activation: "open-mic", holdMs: 400 });
    gate.step(0.9, 0);
    gate.isMuted = true;
    expect(gate.step(0.9, 20)).toEqual({
      isOpen: false,
      didOpen: false,
      didClose: true,
    });
  });

  it("does not replay a key release that happened while muted", () => {
    const gate = new VoiceGate({ activation: "push-to-talk", releaseMs: 150 });
    gate.isKeyHeld = true;
    gate.isMuted = true;
    gate.step(0, 0);
    gate.isKeyHeld = false;
    gate.step(0, 20);
    gate.isMuted = false;
    expect(gate.step(0, 40).isOpen).toBe(false);
  });

  it("is open through a microphone test without the key", () => {
    const gate = new VoiceGate({ activation: "push-to-talk" });
    gate.isForcedOpen = true;
    expect(run(gate, [0, 0])).toEqual([true, true]);
    gate.isMuted = true;
    expect(run(gate, [0], 40)).toEqual([false]);
  });

  it("forgets its tail on reset", () => {
    const gate = new VoiceGate({ activation: "open-mic", holdMs: 400 });
    gate.step(0.9, 0);
    gate.reset();
    expect(gate.isSending).toBe(false);
    expect(gate.step(0, 20).isOpen).toBe(false);
  });
});
