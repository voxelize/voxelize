import { MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { VoiceCapture, VoiceCaptureError } from "./capture";
import { VOICE_FRAME_SAMPLES } from "./codec";
import { VoicePlacement, VoiceSink } from "./sink";
import { VOICE_LOOPBACK_ID, VoiceChat, VoiceChatOptions } from "./voice-chat";

/** A frame of constant amplitude; its RMS is the amplitude. */
const frameOf = (amplitude: number) =>
  new Float32Array(VOICE_FRAME_SAMPLES).fill(amplitude);

const LOUD = 0.3; // about -10 dBFS: over any threshold
const QUIET = 0.0005; // about -66 dBFS: under the meter's floor

class FakeSink implements VoiceSink {
  clock = 0;
  played: { speakerId: string; when: number; amplitude: number }[] = [];
  placed = new Map<string, VoicePlacement>();
  removed: string[] = [];
  volume = 1;
  now() {
    return this.clock;
  }
  play(speakerId: string, samples: Float32Array, _rate: number, when: number) {
    this.played.push({ speakerId, when, amplitude: samples[0] });
  }
  place(speakerId: string, placement: VoicePlacement) {
    this.placed.set(speakerId, placement);
  }
  setListener() {}
  setVolume(volume: number) {
    this.volume = volume;
  }
  remove(speakerId: string) {
    this.removed.push(speakerId);
  }
  dispose() {}
}

class FakeCapture implements VoiceCapture {
  static problem: VoiceCaptureError | null = null;
  static last: FakeCapture | null = null;
  deviceId: string | null = null;
  isOpen = false;
  private onFrame: ((samples: Float32Array) => void) | null = null;
  private onEnded: (() => void) | null = null;
  async start(
    deviceId: string | null,
    onFrame: (samples: Float32Array) => void,
    onEnded: () => void,
  ) {
    FakeCapture.last = this;
    if (FakeCapture.problem) throw FakeCapture.problem;
    this.deviceId = deviceId;
    this.onFrame = onFrame;
    this.onEnded = onEnded;
    this.isOpen = true;
  }
  stop() {
    this.isOpen = false;
  }
  emit(amplitude: number) {
    this.onFrame?.(frameOf(amplitude));
  }
  unplug() {
    this.onEnded?.();
  }
}

/** A voice with every platform piece faked: a packet is its frame's amplitude. */
const makeVoice = (options: Partial<VoiceChatOptions> = {}) => {
  FakeCapture.problem = null;
  FakeCapture.last = null;
  const sink = new FakeSink();
  const time = { ms: 0 };
  const voice = new VoiceChat({
    createSink: () => sink,
    createCapture: () => new FakeCapture(),
    createEncoder: (onPacket) => ({
      encode: (samples) => onPacket(new Uint8Array([samples[0] * 200])),
      close() {},
    }),
    createDecoder: (onSamples) => ({
      decode: (data) => onSamples(frameOf(data[0] / 200), 48000),
      close() {},
    }),
    isSupported: () => true,
    now: () => time.ms,
    ...options,
  });
  /** Capture one frame every 20 ms. */
  const capture = (...amplitudes: number[]) => {
    for (const amplitude of amplitudes) {
      FakeCapture.last!.emit(amplitude);
      time.ms += 20;
      sink.clock += 0.02;
    }
  };
  const join = (voiceRange: number | null = 32) =>
    voice.onMessage({
      type: "INIT",
      json: { id: "me", options: { voiceRange } },
    });
  /** What was queued for the server since the last look. */
  const sent = () => voice.packets.splice(0, voice.packets.length);
  const frames = (packets: MessageProtocol[]) =>
    packets.flatMap((packet) => packet.voices ?? []);
  const states = (packets: MessageProtocol[]) =>
    packets.filter((packet) => !packet.voices?.length).map((p) => p.json);
  const hear = (sender: string, seq: number, amplitude = LOUD, end = false) =>
    voice.onMessage({
      type: "VOICE",
      voices: [{ sender, seq, data: new Uint8Array([amplitude * 200]), end }],
    });
  return { voice, sink, time, capture, join, sent, frames, states, hear };
};

describe("VoiceChat: joining a world", () => {
  it("offers voice only where the world has a range", () => {
    const { voice, join } = makeVoice();
    expect(voice.isAvailable).toBe(false);
    join(null);
    expect(voice.isAvailable).toBe(false);
    join(32);
    expect(voice.getState().range).toBe(32);
  });

  it("says nothing to the server until the player turns voice on", async () => {
    const { voice, join, sent, states } = makeVoice();
    join();
    expect(sent()).toEqual([]);
    await voice.enable();
    expect(states(sent()).at(-1)).toEqual({
      mic: "live",
      deafened: false,
      ignored: [],
    });
    voice.disable();
    expect(states(sent())).toEqual([
      { mic: "off", deafened: false, ignored: [] },
    ]);
  });

  it("tells a new session its state again after a reconnect", async () => {
    const { voice, join, sent, states } = makeVoice();
    join();
    await voice.enable();
    sent();
    join();
    expect(states(sent())).toEqual([
      { mic: "live", deafened: false, ignored: [] },
    ]);
  });

  it("claims no voice in a world without it, even when turned on", async () => {
    const { voice, join, sent, capture, frames } = makeVoice();
    join(null);
    await voice.enable();
    voice.setTalkKeyHeld(true);
    capture(LOUD, LOUD);
    expect(frames(sent())).toEqual([]);
  });

  it("can be told its world when it was made after the join", async () => {
    const { voice, sent, states } = makeVoice();
    voice.joinWorld("me", 24);
    expect(voice.getState().range).toBe(24);
    await voice.enable({ withMicrophone: false });
    expect(states(sent()).at(-1)).toMatchObject({ mic: "muted" });
    voice.joinWorld("me", undefined);
    expect(voice.isAvailable).toBe(false);
  });

  it("does nothing in a browser that cannot do voice", async () => {
    const { voice, join } = makeVoice({ isSupported: () => false });
    join();
    await voice.enable();
    expect(voice.getState().isEnabled).toBe(false);
    expect(voice.getState().isSupported).toBe(false);
  });
});

describe("VoiceChat: the microphone", () => {
  it("listens without speaking when the microphone is refused", async () => {
    const { voice, join, sent, states } = makeVoice();
    join();
    FakeCapture.problem = new VoiceCaptureError("blocked", "denied");
    const enabling = voice.enable();
    FakeCapture.problem = new VoiceCaptureError("blocked", "denied");
    await enabling;
    expect(voice.getState()).toMatchObject({
      isEnabled: true,
      micStatus: "blocked",
    });
    expect(states(sent()).at(-1)).toMatchObject({ mic: "muted" });
  });

  it("can be turned on for listening only, and given a microphone later", async () => {
    const { voice, join, sent, states } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    expect(voice.getState().micStatus).toBe("none");
    expect(FakeCapture.last).toBeNull();
    expect(states(sent()).at(-1)).toMatchObject({ mic: "muted" });
    await voice.retryMicrophone();
    expect(voice.getState().micStatus).toBe("ready");
    expect(states(sent()).at(-1)).toMatchObject({ mic: "live" });
  });

  it("goes back to listening when the microphone is unplugged", async () => {
    const { voice, join, sent, states } = makeVoice();
    join();
    await voice.enable();
    sent();
    FakeCapture.last!.unplug();
    expect(voice.getState().micStatus).toBe("no-device");
    expect(states(sent())).toEqual([
      { mic: "muted", deafened: false, ignored: [] },
    ]);
  });

  it("reopens on the microphone the player picks", async () => {
    const { voice, join } = makeVoice();
    join();
    await voice.enable();
    const first = FakeCapture.last!;
    await voice.setInputDevice("usb-mic");
    expect(first.isOpen).toBe(false);
    expect(FakeCapture.last!.deviceId).toBe("usb-mic");
    expect(voice.getState().micStatus).toBe("ready");
  });

  it("closes the microphone when voice is turned off", async () => {
    const { voice, join } = makeVoice();
    join();
    await voice.enable();
    voice.disable();
    expect(FakeCapture.last!.isOpen).toBe(false);
    expect(voice.getState()).toMatchObject({
      isEnabled: false,
      micStatus: "none",
    });
  });

  it("reads the input level whether or not anything is sent", async () => {
    const { voice, join, capture } = makeVoice();
    join();
    await voice.enable();
    capture(LOUD);
    expect(voice.inputLevel).toBeGreaterThan(0.7);
    capture(QUIET);
    expect(voice.inputLevel).toBeLessThan(0.82);
    expect(voice.inputLevel).toBeGreaterThan(0.5);
  });
});

describe("VoiceChat: sending", () => {
  it("sends in push-to-talk only while the key is held, then marks the end", async () => {
    const { voice, join, sent, capture, frames } = makeVoice();
    join();
    await voice.enable();
    sent();

    capture(LOUD, LOUD);
    expect(frames(sent())).toEqual([]);
    expect(voice.getState().isTransmitting).toBe(false);

    voice.setTalkKeyHeld(true);
    capture(LOUD, QUIET, LOUD);
    expect(voice.getState().isTransmitting).toBe(true);
    const spoken = frames(sent());
    expect(spoken.map((frame) => frame.seq)).toEqual([0, 1, 2]);
    expect(spoken.every((frame) => frame.data.byteLength === 1)).toBe(true);

    voice.setTalkKeyHeld(false);
    // The 150 ms release tail, then the end mark.
    capture(...Array(10).fill(LOUD));
    const tail = frames(sent());
    expect(tail.at(-1)).toMatchObject({ end: true });
    expect(tail.at(-1)!.data.byteLength).toBe(0);
    expect(tail.length).toBeLessThan(10);
    expect(voice.getState().isTransmitting).toBe(false);
  });

  it("opens an open mic on speech and sends what led up to it", async () => {
    const { voice, join, sent, capture, frames } = makeVoice();
    join();
    await voice.enable();
    voice.setActivation("open-mic");
    sent();

    capture(QUIET, QUIET, QUIET, QUIET, QUIET);
    expect(frames(sent())).toEqual([]);

    capture(LOUD);
    // Three frames of lead-in, then the loud one.
    expect(frames(sent()).map((frame) => frame.data[0])).toEqual([
      0,
      0,
      0,
      Math.floor(LOUD * 200),
    ]);
  });

  it("sends nothing while muted, and says so to the server", async () => {
    const { voice, join, sent, capture, frames, states } = makeVoice();
    join();
    await voice.enable();
    voice.setTalkKeyHeld(true);
    sent();

    voice.setMicMuted(true);
    capture(LOUD, LOUD);
    const packets = sent();
    expect(frames(packets).filter((frame) => !frame.end)).toEqual([]);
    expect(states(packets)).toEqual([
      { mic: "muted", deafened: false, ignored: [] },
    ]);

    voice.setMicMuted(false);
    capture(LOUD);
    const after = sent();
    expect(states(after)).toEqual([
      { mic: "live", deafened: false, ignored: [] },
    ]);
    expect(frames(after)).toHaveLength(1);
  });

  it("does not pile voice up behind a dead connection", async () => {
    const { voice, join, capture, frames, states } = makeVoice();
    join();
    await voice.enable();
    voice.setTalkKeyHeld(true);
    // Nothing takes the packets for four seconds.
    capture(...Array(200).fill(LOUD));
    const queued = frames(voice.packets);
    expect(queued.length).toBe(25);
    expect(queued.at(-1)!.seq).toBe(199);
    // What the server needs first is still ahead of every frame: muted
    // while the microphone opened, then live.
    expect(states(voice.packets.slice(0, 2))).toEqual([
      { mic: "muted", deafened: false, ignored: [] },
      { mic: "live", deafened: false, ignored: [] },
    ]);
  });
});

describe("VoiceChat: hearing", () => {
  const listener = {
    position: [0, 64, 0],
    forward: [0, 0, -1],
    up: [0, 1, 0],
  } as const;

  it("plays a speaker's frames end to end, placed where they stand", async () => {
    const { voice, sink, join, hear } = makeVoice();
    join(32);
    await voice.enable({ withMicrophone: false });

    hear("ann", 10);
    hear("ann", 11);
    hear("ann", 12);
    expect(sink.played.map((p) => Number(p.when.toFixed(3)))).toEqual([
      0.06, 0.08, 0.1,
    ]);

    voice.update(listener, (id) => (id === "ann" ? [8, 64, 0] : null));
    expect(sink.placed.get("ann")).toEqual({
      gain: 0.5,
      position: [8, 64, 0],
      muffle: 0,
    });
    expect(voice.getSpeakers()).toHaveLength(1);
    expect(voice.getSpeakers()[0]).toMatchObject({
      id: "ann",
      distance: 8,
      falloff: 0.5,
    });
  });

  it("shows the level of what is sounding now, not of what is still queued", async () => {
    const { voice, sink, join, hear } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    hear("ann", 1, LOUD);
    voice.update(listener, () => [1, 64, 0]);
    expect(voice.getSpeakers()[0].level).toBe(0);
    sink.clock = 0.07;
    voice.update(listener, () => [1, 64, 0]);
    expect(voice.getSpeakers()[0].level).toBeGreaterThan(0.7);
  });

  it("is silent for a speaker past the range or one it cannot find", async () => {
    const { voice, sink, join, hear } = makeVoice();
    join(32);
    await voice.enable({ withMicrophone: false });
    hear("far", 1);
    hear("ghost", 1);
    voice.update(listener, (id) => (id === "far" ? [0, 64, 34] : null));
    expect(sink.placed.get("far")!.gain).toBe(0);
    expect(sink.placed.get("ghost")).toEqual({
      gain: 0,
      position: null,
      muffle: 0,
    });
  });

  it("applies the player's own volume and the wall between them", async () => {
    const { voice, sink, join, hear } = makeVoice();
    join(32);
    await voice.enable({ withMicrophone: false });
    hear("ann", 1);
    voice.setSpeakerVolume("ann", 2);
    voice.setSpeakerMuffle("ann", 0.8);
    voice.update(listener, () => [8, 64, 0]);
    expect(sink.placed.get("ann")).toMatchObject({ gain: 1, muffle: 0.8 });
    voice.setVolume(1.5);
    expect(sink.volume).toBe(1.5);
    expect(voice.getState().volume).toBe(1.5);
  });

  it("stops listing a speaker shortly after their last sound", async () => {
    const { voice, sink, time, join, hear } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    let changes = 0;
    voice.subscribeSpeakers(() => changes++);
    hear("ann", 1);
    voice.update(listener, () => [1, 64, 0]);
    expect(voice.getSpeakers()).toHaveLength(1);
    expect(changes).toBe(1);

    sink.clock = 0.5;
    time.ms = 500;
    voice.update(listener, () => [1, 64, 0]);
    expect(voice.getSpeakers()).toHaveLength(0);
    expect(changes).toBe(2);
  });

  it("lists the nearest speaker first", async () => {
    const { voice, join, hear } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    hear("far", 1);
    hear("near", 1);
    voice.update(listener, (id) => (id === "near" ? [2, 64, 0] : [20, 64, 0]));
    expect(voice.getSpeakers().map((speaker) => speaker.id)).toEqual([
      "near",
      "far",
    ]);
  });

  it("never plays its own voice or a muted speaker's", async () => {
    const { voice, sink, join, sent, states, hear } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    sent();

    hear("me", 1);
    voice.setSpeakerMuted("rude", true);
    hear("rude", 1);
    expect(sink.played).toEqual([]);
    expect(voice.isSpeakerMuted("rude")).toBe(true);
    // The mute is the server's to keep.
    expect(states(sent())).toEqual([
      { mic: "muted", deafened: false, ignored: ["rude"] },
    ]);

    voice.setSpeakerMuted("rude", false);
    hear("rude", 2);
    expect(sink.played).toHaveLength(1);
    expect(states(sent())).toEqual([
      { mic: "muted", deafened: false, ignored: [] },
    ]);
  });

  it("cuts a speaker off the moment they are muted", async () => {
    const { voice, sink, join, hear } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    hear("rude", 1);
    voice.setSpeakerMuted("rude", true);
    expect(sink.removed).toEqual(["rude"]);
    voice.update(listener, () => [1, 64, 0]);
    expect(voice.getSpeakers()).toEqual([]);
  });

  it("hears nobody while deafened, and tells the server to stop sending", async () => {
    const { voice, sink, join, sent, states, hear, capture, frames } =
      makeVoice();
    join();
    await voice.enable();
    voice.setTalkKeyHeld(true);
    sent();

    voice.setDeafened(true);
    hear("ann", 1);
    capture(LOUD);
    const packets = sent();
    expect(sink.played).toEqual([]);
    expect(states(packets)).toEqual([
      { mic: "muted", deafened: true, ignored: [] },
    ]);
    expect(frames(packets).filter((frame) => !frame.end)).toEqual([]);
  });

  it("hears nothing with voice off", () => {
    const { sink, join, hear } = makeVoice();
    join();
    hear("ann", 1);
    expect(sink.played).toEqual([]);
  });

  it("forgets a speaker who left or went quiet for long", async () => {
    const { voice, sink, time, join, hear } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    hear("ann", 1);
    hear("bob", 1);
    voice.onMessage({ type: "LEAVE", text: "ann" });
    expect(sink.removed).toEqual(["ann"]);

    time.ms = 11_000;
    sink.clock = 11;
    voice.update(listener, () => [1, 64, 0]);
    expect(sink.removed).toEqual(["ann", "bob"]);
  });

  it("keeps the saved mutes it is handed on join", async () => {
    const { voice, join, sent, states } = makeVoice();
    join();
    voice.setMutedSpeakers(["b", "a"]);
    await voice.enable({ withMicrophone: false });
    expect(states(sent()).at(-1)).toEqual({
      mic: "muted",
      deafened: false,
      ignored: ["a", "b"],
    });
  });
});

describe("VoiceChat: the microphone test", () => {
  it("plays the player's own voice back and sends none of it", async () => {
    const { voice, sink, join, sent, capture, frames } = makeVoice();
    join();
    await voice.enable();
    sent();

    voice.setTesting(true);
    capture(LOUD, LOUD);
    expect(frames(sent())).toEqual([]);
    expect(sink.played.map((p) => p.speakerId)).toEqual([
      VOICE_LOOPBACK_ID,
      VOICE_LOOPBACK_ID,
    ]);
    voice.update(null, () => null);
    expect(sink.placed.get(VOICE_LOOPBACK_ID)).toEqual({
      gain: 1,
      position: null,
      muffle: 0,
    });
    // The player is not listed as someone they hear.
    expect(voice.getSpeakers()).toEqual([]);

    voice.setTesting(false);
    expect(sink.removed).toContain(VOICE_LOOPBACK_ID);
    capture(LOUD);
    expect(frames(sent()).filter((frame) => !frame.end)).toEqual([]);
  });

  it("still applies the open-mic threshold, so it can be set by ear", async () => {
    const { voice, sink, join, capture } = makeVoice();
    join();
    await voice.enable();
    voice.setActivation("open-mic");
    voice.setTesting(true);
    capture(QUIET, QUIET);
    expect(sink.played).toEqual([]);
    capture(LOUD);
    expect(sink.played.length).toBeGreaterThan(0);
  });

  it("works while the mic is muted, and needs a microphone", async () => {
    const { voice, sink, join, capture } = makeVoice();
    join();
    await voice.enable({ withMicrophone: false });
    voice.setTesting(true);
    expect(voice.getState().isTesting).toBe(false);

    await voice.retryMicrophone();
    voice.setMicMuted(true);
    voice.setTesting(true);
    capture(LOUD);
    expect(sink.played).toHaveLength(1);
  });
});

describe("VoiceChat: state", () => {
  it("hands subscribers a new state object only when something changed", async () => {
    const { voice, join } = makeVoice();
    let calls = 0;
    voice.subscribe(() => calls++);
    const before = voice.getState();
    voice.setThreshold(before.threshold);
    expect(calls).toBe(0);
    expect(voice.getState()).toBe(before);
    join();
    expect(calls).toBe(1);
    expect(voice.getState()).not.toBe(before);
    voice.setThreshold(2);
    expect(voice.getState().threshold).toBe(1);
  });
});
