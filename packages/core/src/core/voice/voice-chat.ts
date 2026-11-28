import { MessageProtocol, VoiceStateProtocol } from "@voxelize/protocol";

import { NetIntercept } from "../network";

import {
  isMicrophoneAvailable,
  MicrophoneCapture,
  VoiceCapture,
  VoiceCaptureError,
  VoiceCaptureFactory,
  VoiceCaptureProblem,
} from "./capture";
import {
  createOpusDecoder,
  createOpusEncoder,
  isVoiceCodecAvailable,
  VOICE_FRAME_MS,
  VoiceDecoderFactory,
  VoiceEncoder,
  VoiceEncoderFactory,
} from "./codec";
import {
  DEFAULT_VOICE_FULL_VOLUME_DISTANCE,
  voiceFalloffGain,
} from "./falloff";
import { DEFAULT_VOICE_GATE, VoiceActivation, VoiceGate } from "./gate";
import { levelFromRms, rms, VoiceLevelMeter } from "./level";
import { VoiceListener, VoiceSink, VoiceVec3, WebAudioVoiceSink } from "./sink";
import { VoiceStream, VoiceStreamOptions } from "./stream";

/** What the microphone is up to. */
export type VoiceMicStatus =
  /** Not asked for: voice is off, or on for listening only. */
  | "none"
  /** Waiting on the browser (the permission prompt, the device). */
  | "starting"
  /** Open and feeding the gate. */
  | "ready"
  | VoiceCaptureProblem;

/** Everything a UI needs to draw the player's own voice controls. */
export type VoiceChatState = {
  /**
   * The world's voice range in blocks: where a voice reaches silence.
   * `null` when the world has no voice (or has not said yet).
   */
  range: number | null;

  /** Whether this browser can encode, decode and capture voice. */
  isSupported: boolean;

  /** Whether the player turned voice on. Off, nothing is sent or received. */
  isEnabled: boolean;

  micStatus: VoiceMicStatus;

  activation: VoiceActivation;

  /** Open-mic threshold, 0..1 on the meter's scale. */
  threshold: number;

  isMicMuted: boolean;

  /** Voice stays on but nothing is heard, and nothing is sent. */
  isDeafened: boolean;

  /** Whether the microphone is being sent right now. */
  isTransmitting: boolean;

  /** Whether the player is hearing their own microphone (and nobody else is). */
  isTesting: boolean;

  /** The chosen microphone; `null` is the browser's default. */
  inputDeviceId: string | null;

  /** Volume of all voices together; 1 is as spoken. */
  volume: number;
};

/** One player currently heard. */
export type VoiceSpeaker = {
  id: string;
  /** Loudness of what is playing right now, 0..1. */
  level: number;
  /** Blocks from the listener; `null` when their position is not known. */
  distance: number | null;
  /** The falloff applied for that distance, 0..1. */
  falloff: number;
};

/** Counters since the voice chat was made, for a debug overlay or a bug report. */
export type VoiceChatStats = {
  /** Frames of the player's own voice handed to the network. */
  framesSent: number;
  /** Frames of other players' voices that reached this client. */
  framesReceived: number;
  /** One entry per speaker currently kept, heard right now or not. */
  streams: {
    id: string;
    /** Milliseconds since their last frame arrived. */
    silentForMs: number;
    /** Frames that arrived after their place had been played. */
    lateFrames: number;
    /** Frames that never arrived in time. */
    lostFrames: number;
    /** Frames dropped to catch up after a burst. */
    droppedFrames: number;
    /** Times the queue ran dry in the middle of an utterance. */
    underruns: number;
    /** Frames the decoder would not take. */
    decodeErrors: number;
    /** The playout delay new utterances start with, in seconds. */
    delay: number;
  }[];
};

export type VoiceChatOptions = {
  /**
   * The context voices play on, or a function that returns it when voice is
   * first turned on (a context made before a click starts suspended).
   * Defaults to a new one.
   */
  audioContext?: AudioContext | (() => AudioContext);

  /** Where voices are mixed into. Defaults to the context's destination. */
  destination?: AudioNode | (() => AudioNode);

  /**
   * Whether voice moves the context's listener from {@link VoiceChat.update}.
   * Off when something else already does (a `THREE.AudioListener` on the
   * camera). Defaults to `true`.
   */
  managesListener?: boolean;

  /** A voice is at full volume this close, in blocks. Defaults to 4. */
  fullVolumeDistance?: number;

  /** A speaker heard nothing from for this long is forgotten. Defaults to 10 s. */
  speakerIdleMs?: number;

  stream?: VoiceStreamOptions;

  /** Replace the platform pieces (tests, or another codec). */
  createSink?: () => VoiceSink;
  createEncoder?: VoiceEncoderFactory;
  createDecoder?: VoiceDecoderFactory;
  createCapture?: VoiceCaptureFactory;
  isSupported?: () => boolean;
  now?: () => number;
};

/** The speaker id of the player's own voice while they test their microphone. */
export const VOICE_LOOPBACK_ID = "\u0000voice-loopback";

/** Open mic: frames kept from just before the gate opened, sent first. */
const PREROLL_FRAMES = 3;

/** Unsent frame packets are capped: stale voice is not worth sending. */
const MAX_QUEUED_FRAME_PACKETS = 25;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Proximity voice for a world that has it (`WorldConfig::voice_range` on
 * the server).
 *
 * Register it on the network, call {@link enable} from a click, and call
 * {@link update} every frame with the ear and a way to find a speaker:
 *
 * ```ts
 * const voice = new VOXELIZE.VoiceChat();
 * network.register(voice);
 * button.onclick = () => voice.enable();
 * // every frame
 * voice.update(
 *   { position, forward, up },
 *   (id) => peers.getPeerById(id)?.position.toArray(),
 * );
 * ```
 *
 * It captures the microphone, sends it while the gate is open
 * (push-to-talk or open mic), and plays every voice the server relays from
 * where its player stands, fading with distance to silence at the world's
 * range. It draws nothing: {@link getState}, {@link getSpeakers} and the
 * peers' `voice` metadata are what a game's UI reads.
 */
export class VoiceChat implements NetIntercept {
  /** Outgoing packets, sent by `network.flush()`. */
  packets: MessageProtocol[] = [];

  private options: VoiceChatOptions;

  private state: VoiceChatState;

  private listeners = new Set<() => void>();

  private speakerListeners = new Set<() => void>();

  private gate = new VoiceGate();

  private inputMeter = new VoiceLevelMeter();

  private sink: VoiceSink | null = null;

  private capture: VoiceCapture | null = null;

  private encoder: VoiceEncoder | null = null;

  private streams = new Map<string, VoiceStream>();

  /** Speakers the player muted: kept by the server, mirrored here. */
  private ignored = new Set<string>();

  private speakerVolumes = new Map<string, number>();

  private speakerMuffles = new Map<string, number>();

  private speakers: VoiceSpeaker[] = [];

  private speakingKey = "";

  private ownId = "";

  private seq = 0;

  private framesEncoded = 0;

  private preroll: Float32Array[] = [];

  /** Bumped by every enable/disable, so a slow start knows it was overtaken. */
  private generation = 0;

  private lastSentState = "";

  private hasJoined = false;

  private framesSent = 0;

  private framesReceived = 0;

  constructor(options: VoiceChatOptions = {}) {
    this.options = options;
    this.state = {
      range: null,
      isSupported: this.checkSupport(),
      isEnabled: false,
      micStatus: "none",
      activation: DEFAULT_VOICE_GATE.activation,
      threshold: DEFAULT_VOICE_GATE.threshold,
      isMicMuted: false,
      isDeafened: false,
      isTransmitting: false,
      isTesting: false,
      inputDeviceId: null,
      volume: 1,
    };
  }

  // ---------------------------------------------------------------- state

  /** The current state. A new object whenever anything in it changes. */
  getState = (): VoiceChatState => this.state;

  /** Be told when {@link getState} changes. Returns the way to stop. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Be told when the set of people heard changes. Returns the way to stop. */
  subscribeSpeakers = (listener: () => void): (() => void) => {
    this.speakerListeners.add(listener);
    return () => {
      this.speakerListeners.delete(listener);
    };
  };

  /**
   * The players heard right now, as of the last {@link update}, nearest
   * first: speaking, and near enough that their voice has any volume. The array is replaced, never mutated, when who is in it changes;
   * each entry's `level` and `distance` are refreshed in place every update.
   */
  getSpeakers = (): readonly VoiceSpeaker[] => this.speakers;

  /** The level of the player's own microphone, 0..1, for a meter. */
  get inputLevel(): number {
    return this.inputMeter.value;
  }

  /**
   * Counters for a debug overlay: when a voice sounds choppy, these say
   * whether frames are not arriving, arriving late, or arriving in bursts
   * the page was too busy to play.
   */
  getStats(): VoiceChatStats {
    const nowMs = this.now();
    return {
      framesSent: this.framesSent,
      framesReceived: this.framesReceived,
      streams: Array.from(this.streams.values(), (stream) => ({
        id: stream.speakerId,
        silentForMs: nowMs - stream.lastArrivalMs,
        lateFrames: stream.jitter.lateFrames,
        lostFrames: stream.jitter.lostFrames,
        droppedFrames: stream.playout.droppedFrames,
        underruns: stream.playout.underruns,
        decodeErrors: stream.decodeErrors,
        delay: stream.playout.currentDelay,
      })),
    };
  }

  /** Whether the world this client joined has voice. */
  get isAvailable(): boolean {
    return this.state.range !== null;
  }

  /** Whether `speakerId` is muted by the player. */
  isSpeakerMuted(speakerId: string): boolean {
    return this.ignored.has(speakerId);
  }

  /** The player's volume for `speakerId`; 1 unless they changed it. */
  getSpeakerVolume(speakerId: string): number {
    return this.speakerVolumes.get(speakerId) ?? 1;
  }

  // ------------------------------------------------------------- controls

  /**
   * Turn voice on. Call it from a click or a key press: it is what opens
   * the browser's microphone prompt and starts audio. With
   * `withMicrophone: false`, or when the microphone is refused, the player
   * listens without speaking (see `micStatus`).
   */
  async enable({ withMicrophone = true } = {}): Promise<void> {
    if (!this.state.isSupported) return;
    const generation = ++this.generation;
    this.ensureSink();
    this.patch({
      isEnabled: true,
      micStatus: withMicrophone ? "starting" : "none",
    });
    this.sendState();
    if (withMicrophone) await this.startCapture(generation);
  }

  /** Turn voice off: the microphone closes and nothing is heard. */
  disable() {
    this.generation += 1;
    this.stopCapture();
    this.dropStreams();
    this.patch({
      isEnabled: false,
      micStatus: "none",
      isTransmitting: false,
      isTesting: false,
    });
    this.gate.isForcedOpen = false;
    this.sendState();
  }

  /**
   * Start audio the browser is holding back. Voice turned on without a
   * click (restored from a saved setting on join) may be given a suspended
   * context; call this from the page's next click or key press.
   */
  resume() {
    this.sink?.resume?.();
    this.capture?.resume?.();
  }

  /** Open the microphone again after a refusal, or after {@link enable} without one. */
  async retryMicrophone(): Promise<void> {
    if (!this.state.isEnabled) return;
    const generation = ++this.generation;
    this.patch({ micStatus: "starting" });
    await this.startCapture(generation);
  }

  /** Close the microphone and keep listening. */
  releaseMicrophone() {
    if (!this.state.isEnabled) return;
    this.generation += 1;
    this.stopCapture();
    this.patch({ micStatus: "none", isTransmitting: false, isTesting: false });
    this.gate.isForcedOpen = false;
    this.sendState();
  }

  /** Pick a microphone (`null` for the browser's default). */
  async setInputDevice(deviceId: string | null): Promise<void> {
    if (deviceId === this.state.inputDeviceId) return;
    this.patch({ inputDeviceId: deviceId });
    if (this.state.isEnabled && this.state.micStatus !== "none") {
      await this.retryMicrophone();
    }
  }

  setActivation(activation: VoiceActivation) {
    if (activation === this.state.activation) return;
    this.gate.options.activation = activation;
    this.gate.reset();
    this.patch({ activation });
  }

  /** Open mic: the level, 0..1, a frame must reach to be sent. */
  setThreshold(threshold: number) {
    const clamped = clamp01(threshold);
    this.gate.options.threshold = clamped;
    this.patch({ threshold: clamped });
  }

  /** Push-to-talk: whether the talk key is down. */
  setTalkKeyHeld(isHeld: boolean) {
    this.gate.isKeyHeld = isHeld;
  }

  setMicMuted(isMicMuted: boolean) {
    if (isMicMuted === this.state.isMicMuted) return;
    this.patch({ isMicMuted });
    this.syncGateMute();
    this.sendState();
  }

  /** Stop hearing everyone (and stop sending) without turning voice off. */
  setDeafened(isDeafened: boolean) {
    if (isDeafened === this.state.isDeafened) return;
    this.patch({ isDeafened });
    this.syncGateMute();
    if (isDeafened) this.dropStreams(VOICE_LOOPBACK_ID);
    this.sendState();
  }

  /**
   * Hear your own microphone, through the same encoder and decoder everyone
   * else gets, instead of sending it. In push-to-talk the gate is held open
   * for the test; in open mic the threshold still applies, so it can be
   * tuned by ear.
   */
  setTesting(isTesting: boolean) {
    if (isTesting === this.state.isTesting) return;
    if (isTesting && this.state.micStatus !== "ready") return;
    this.gate.isForcedOpen =
      isTesting && this.state.activation === "push-to-talk";
    if (!isTesting) this.dropStream(VOICE_LOOPBACK_ID);
    this.patch({ isTesting });
    this.syncGateMute();
  }

  /** Volume of all voices together; 1 is as spoken, 2 is the most. */
  setVolume(volume: number) {
    const clamped = Math.min(2, Math.max(0, volume));
    this.sink?.setVolume(clamped);
    this.patch({ volume: clamped });
  }

  /** The player's own volume for one speaker; 1 is as spoken, 2 is the most. */
  setSpeakerVolume(speakerId: string, volume: number) {
    const clamped = Math.min(2, Math.max(0, volume));
    if (clamped === 1) this.speakerVolumes.delete(speakerId);
    else this.speakerVolumes.set(speakerId, clamped);
  }

  /**
   * Mute one speaker for this player. The server stops sending their voice
   * here at all; nobody else is affected and the speaker is not told.
   */
  setSpeakerMuted(speakerId: string, isMuted: boolean) {
    if (isMuted === this.ignored.has(speakerId)) return;
    if (isMuted) {
      this.ignored.add(speakerId);
      this.dropStream(speakerId);
    } else {
      this.ignored.delete(speakerId);
    }
    this.sendState();
    this.emitSpeakers();
  }

  /** Replace the whole muted list at once (a saved list, on join). */
  setMutedSpeakers(speakerIds: Iterable<string>) {
    this.ignored = new Set(speakerIds);
    for (const speakerId of this.ignored) this.dropStream(speakerId);
    this.sendState();
    this.emitSpeakers();
  }

  /**
   * How much stands between the ear and a speaker, 0 (clear air) to 1 (a
   * wall): the game's to work out, with whatever it knows about its world.
   */
  setSpeakerMuffle(speakerId: string, muffle: number) {
    this.speakerMuffles.set(speakerId, clamp01(muffle));
  }

  // --------------------------------------------------------------- frame

  /**
   * Once a frame: place every voice. `listener` is the ear (`null` keeps the
   * last one); `positionOf` finds a speaker's position by client id, and a
   * speaker it cannot find is silent.
   */
  update(
    listener: VoiceListener | null,
    positionOf: (speakerId: string) => VoiceVec3 | null | undefined,
  ) {
    const nowMs = this.now();
    const sink = this.sink;
    if (!sink) return;
    if (listener) sink.setListener(listener);
    const ear = listener?.position;
    const range = this.state.range ?? 0;
    const full =
      this.options.fullVolumeDistance ?? DEFAULT_VOICE_FULL_VOLUME_DISTANCE;
    const idleMs = this.options.speakerIdleMs ?? 10_000;

    const speaking: VoiceSpeaker[] = [];
    for (const [speakerId, stream] of this.streams) {
      stream.tick(nowMs);
      if (nowMs - stream.lastArrivalMs > idleMs) {
        this.dropStream(speakerId);
        continue;
      }

      if (speakerId === VOICE_LOOPBACK_ID) {
        sink.place(speakerId, { gain: 1, position: null, muffle: 0 });
        continue;
      }

      const position = positionOf(speakerId) ?? null;
      let distance: number | null = null;
      let falloff = 0;
      if (position && ear) {
        distance = Math.hypot(
          position[0] - ear[0],
          position[1] - ear[1],
          position[2] - ear[2],
        );
        falloff = voiceFalloffGain(distance, {
          fullVolumeDistance: full,
          range,
        });
      }
      sink.place(speakerId, {
        gain: falloff * this.getSpeakerVolume(speakerId),
        position,
        muffle: this.speakerMuffles.get(speakerId) ?? 0,
      });

      // Heard means audible: in the last blocks of the relay's margin a
      // voice still arrives, at a gain of nothing, and is not listed.
      if (falloff > 0 && stream.isSpeaking(nowMs)) {
        speaking.push({
          id: speakerId,
          level: stream.currentLevel(),
          distance,
          falloff,
        });
      }
    }

    speaking.sort(
      (a, b) =>
        (a.distance ?? Number.POSITIVE_INFINITY) -
          (b.distance ?? Number.POSITIVE_INFINITY) || (a.id < b.id ? -1 : 1),
    );
    const key = speaking.map((speaker) => speaker.id).join("\u0001");
    if (key !== this.speakingKey) {
      this.speakingKey = key;
      this.speakers = speaking;
      this.emitSpeakers();
    } else {
      for (let i = 0; i < speaking.length; i++) {
        Object.assign(this.speakers[i], speaking[i]);
      }
    }
  }

  // ------------------------------------------------------------- network

  /**
   * Tell voice which world this client is in: its own id there and the
   * world's `voiceRange` option. Registered on the network before the join,
   * voice reads both from the INIT itself; this is for a voice chat made
   * after it (pass what `world.initialData` kept).
   */
  joinWorld(ownId: string, voiceRange: number | null | undefined) {
    this.ownId = ownId;
    this.hasJoined = true;
    this.patch({
      range:
        typeof voiceRange === "number" && voiceRange > 0 ? voiceRange : null,
    });
    // A new session on the server knows nothing of this client's voice.
    this.lastSentState = "";
    this.sendState();
  }

  onMessage = (message: MessageProtocol) => {
    switch (message.type) {
      case "INIT": {
        const json = message.json as
          | { id?: string; options?: { voiceRange?: number | null } }
          | undefined;
        this.joinWorld(json?.id ?? "", json?.options?.voiceRange);
        break;
      }
      case "VOICE": {
        const { voices } = message;
        if (!voices || !this.state.isEnabled || this.state.isDeafened) break;
        const nowMs = this.now();
        for (const voice of voices) {
          const sender = voice.sender;
          if (!sender || sender === this.ownId || this.ignored.has(sender)) {
            continue;
          }
          this.framesReceived += 1;
          this.streamOf(sender)?.push(
            voice.seq >>> 0,
            voice.data,
            voice.end === true,
            nowMs,
          );
        }
        break;
      }
      case "LEAVE": {
        if (message.text) this.dropStream(message.text);
        break;
      }
    }
  };

  /** Close everything. The instance is not usable afterwards. */
  dispose() {
    this.generation += 1;
    this.stopCapture();
    this.dropStreams();
    this.sink?.dispose();
    this.sink = null;
    this.packets.length = 0;
    this.listeners.clear();
    this.speakerListeners.clear();
  }

  // -------------------------------------------------------------- private

  private now(): number {
    return this.options.now ? this.options.now() : performance.now();
  }

  private checkSupport(): boolean {
    if (this.options.isSupported) return this.options.isSupported();
    return isVoiceCodecAvailable() && typeof AudioContext === "function";
  }

  private patch(change: Partial<VoiceChatState>) {
    let hasChanged = false;
    for (const key of Object.keys(change) as (keyof VoiceChatState)[]) {
      if (this.state[key] !== change[key]) hasChanged = true;
    }
    if (!hasChanged) return;
    this.state = { ...this.state, ...change };
    for (const listener of Array.from(this.listeners)) listener();
  }

  private emitSpeakers() {
    for (const listener of Array.from(this.speakerListeners)) listener();
  }

  private ensureSink(): VoiceSink {
    if (this.sink) return this.sink;
    if (this.options.createSink) {
      this.sink = this.options.createSink();
    } else {
      const { audioContext, destination, managesListener } = this.options;
      const context =
        typeof audioContext === "function"
          ? audioContext()
          : audioContext ?? new AudioContext();
      if (context.state === "suspended") void context.resume();
      this.sink = new WebAudioVoiceSink(context, {
        destination:
          typeof destination === "function" ? destination() : destination,
        managesListener,
      });
    }
    this.sink.setVolume(this.state.volume);
    return this.sink;
  }

  /** What the server is told: only a ready, unmuted microphone is live. */
  private wireState(): VoiceStateProtocol {
    const { isEnabled, micStatus, isMicMuted, isDeafened } = this.state;
    if (!isEnabled || this.state.range === null) {
      return { mic: "off", deafened: false, ignored: [] };
    }
    const isLive = micStatus === "ready" && !isMicMuted && !isDeafened;
    return {
      mic: isLive ? "live" : "muted",
      deafened: isDeafened,
      ignored: Array.from(this.ignored).sort(),
    };
  }

  private sendState() {
    if (!this.hasJoined) return;
    const wire = this.wireState();
    const key = JSON.stringify(wire);
    if (key === this.lastSentState) return;
    // A client that never turned voice on has nothing to say about it.
    if (this.lastSentState === "" && wire.mic === "off") return;
    this.lastSentState = key;
    this.packets.push({ type: "VOICE", json: wire });
  }

  private syncGateMute() {
    const { isMicMuted, isDeafened, isTesting } = this.state;
    // A test is for hearing the microphone: the mute does not apply to it.
    this.gate.isMuted = !isTesting && (isMicMuted || isDeafened);
  }

  private async startCapture(generation: number) {
    this.stopCapture();
    const capture = this.options.createCapture
      ? this.options.createCapture()
      : new MicrophoneCapture();
    this.capture = capture;
    try {
      if (!this.options.createCapture && !isMicrophoneAvailable()) {
        throw new VoiceCaptureError(
          "failed",
          "No microphone access in this browser",
        );
      }
      await capture.start(
        this.state.inputDeviceId,
        (samples) => {
          if (generation === this.generation) this.onCapturedFrame(samples);
        },
        () => {
          if (generation !== this.generation) return;
          // Unplugged, or taken away by the browser.
          this.stopCapture();
          this.patch({
            micStatus: "no-device",
            isTransmitting: false,
            isTesting: false,
          });
          this.sendState();
        },
      );
    } catch (error) {
      if (generation !== this.generation) return;
      this.stopCapture();
      this.patch({
        micStatus:
          error instanceof VoiceCaptureError ? error.problem : "failed",
        isTransmitting: false,
      });
      this.sendState();
      return;
    }
    if (generation !== this.generation) {
      capture.stop();
      return;
    }
    this.syncGateMute();
    this.patch({ micStatus: "ready" });
    this.sendState();
  }

  private stopCapture() {
    this.capture?.stop();
    this.capture = null;
    this.closeEncoder();
    this.gate.reset();
    this.preroll = [];
    this.inputMeter.reset();
    this.dropStream(VOICE_LOOPBACK_ID);
  }

  private closeEncoder() {
    const encoder = this.encoder;
    this.encoder = null;
    try {
      encoder?.close();
    } catch {
      // Closed already by its own error.
    }
  }

  private onCapturedFrame(samples: Float32Array) {
    const nowMs = this.now();
    const level = levelFromRms(rms(samples));
    this.inputMeter.push(level, VOICE_FRAME_MS);
    const step = this.gate.step(level, nowMs);

    if (!step.isOpen) {
      if (step.didClose) {
        this.emitFrame(new Uint8Array(0), true);
        this.patch({ isTransmitting: false });
      }
      this.preroll.push(samples);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      return;
    }

    if (step.didOpen) {
      this.patch({ isTransmitting: true });
      // The gate opens on the first loud frame; the consonant that led up
      // to it is in the frames just before.
      if (this.state.activation === "open-mic") {
        for (const earlier of this.preroll) this.encode(earlier);
      }
      this.preroll = [];
    }
    this.encode(samples);
  }

  private encode(samples: Float32Array) {
    if (!this.encoder) {
      const create = this.options.createEncoder ?? createOpusEncoder;
      try {
        this.encoder = create(
          (data) => this.emitFrame(data, false),
          () => this.closeEncoder(),
        );
      } catch {
        return;
      }
    }
    try {
      this.encoder.encode(samples, this.framesEncoded * VOICE_FRAME_MS * 1000);
      this.framesEncoded += 1;
    } catch {
      this.closeEncoder();
    }
  }

  /** One encoded frame (or the empty end mark) on its way out. */
  private emitFrame(data: Uint8Array, isEnd: boolean) {
    if (!isEnd && data.byteLength === 0) return;
    const seq = this.seq;
    this.seq = (this.seq + 1) >>> 0;

    if (this.state.isTesting) {
      this.streamOf(VOICE_LOOPBACK_ID)?.push(seq, data, isEnd, this.now());
      return;
    }
    if (this.state.range === null) return;

    let queued = 0;
    for (const packet of this.packets) {
      if (packet.type === "VOICE" && packet.voices?.length) queued += 1;
    }
    if (queued >= MAX_QUEUED_FRAME_PACKETS) {
      const oldest = this.packets.findIndex(
        (packet) => packet.type === "VOICE" && !!packet.voices?.length,
      );
      if (oldest >= 0) this.packets.splice(oldest, 1);
    }
    if (!isEnd) this.framesSent += 1;
    this.packets.push({
      type: "VOICE",
      voices: [isEnd ? { seq, data, end: true } : { seq, data }],
    });
  }

  private streamOf(speakerId: string): VoiceStream | null {
    let stream = this.streams.get(speakerId);
    if (stream) return stream;
    const sink = this.sink;
    if (!sink) return null;
    stream = new VoiceStream(
      speakerId,
      this.options.createDecoder ?? createOpusDecoder,
      sink,
      this.options.stream,
    );
    this.streams.set(speakerId, stream);
    // The player's own test voice has no place in the world to wait for:
    // it is heard at once, whether or not the game is calling update.
    if (speakerId === VOICE_LOOPBACK_ID) {
      sink.place(speakerId, { gain: 1, position: null, muffle: 0 });
    }
    return stream;
  }

  private dropStream(speakerId: string) {
    const stream = this.streams.get(speakerId);
    if (!stream) return;
    stream.dispose();
    this.streams.delete(speakerId);
  }

  private dropStreams(except?: string) {
    for (const speakerId of Array.from(this.streams.keys())) {
      if (speakerId !== except) this.dropStream(speakerId);
    }
  }
}
