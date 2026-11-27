/** A point or direction in world space. */
export type VoiceVec3 = readonly [number, number, number];

/** Where one speaker is heard from, and how. */
export type VoicePlacement = {
  /** Final linear gain: distance falloff times the player's own volume for them. */
  gain: number;

  /** Where the voice comes from; `null` plays it in the head, undirected. */
  position: VoiceVec3 | null;

  /** How much is in the way, 0 (clear) to 1 (a wall): duller and quieter. */
  muffle: number;
};

/** The ear voices are heard from. */
export type VoiceListener = {
  position: VoiceVec3;
  forward: VoiceVec3;
  up: VoiceVec3;
};

/** Where decoded voices go. The page's is {@link WebAudioVoiceSink}. */
export interface VoiceSink {
  /** The output clock, in seconds. */
  now(): number;

  /** Queue `samples` of one speaker to start at `when` on the clock. */
  play(
    speakerId: string,
    samples: Float32Array,
    sampleRate: number,
    when: number,
  ): void;

  place(speakerId: string, placement: VoicePlacement): void;

  setListener(listener: VoiceListener): void;

  /** The volume of all voices together; 1 is as spoken, above it is a boost. */
  setVolume(volume: number): void;

  /** Free everything kept for a speaker who went quiet. */
  remove(speakerId: string): void;

  /**
   * Start the output if the browser is holding it (a context made before
   * the page's first click starts suspended). Call from a click or a key.
   */
  resume?(): void;

  dispose(): void;
}

export type WebAudioVoiceSinkOptions = {
  /** Where voices are mixed into. Defaults to the context's destination. */
  destination?: AudioNode;

  /**
   * Whether the sink moves the context's listener itself. Off for an app
   * that already drives it (a `THREE.AudioListener` on the camera does).
   */
  managesListener?: boolean;

  /** `HRTF` (default) places a voice all around the head; `equalpower` is cheaper. */
  panningModel?: PanningModelType;
};

/** Changes to a gain or a position glide over this long, in seconds. */
const SMOOTHING = 0.04;

/** A muffled voice keeps this much of its treble and its level. */
const MUFFLED_CUTOFF_HZ = 700;
const OPEN_CUTOFF_HZ = 20000;
const MUFFLED_GAIN = 0.7;

type SpeakerNodes = {
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
  isSpatial: boolean;
};

/**
 * Voices through Web Audio: each speaker has a gain, a low-pass for walls
 * and a panner, and all of them meet in one volume control.
 */
export class WebAudioVoiceSink implements VoiceSink {
  private master: GainNode;

  private speakers = new Map<string, SpeakerNodes>();

  private managesListener: boolean;

  private panningModel: PanningModelType;

  private ear: VoiceVec3 = [0, 0, 0];

  constructor(
    private context: AudioContext,
    options: WebAudioVoiceSinkOptions = {},
  ) {
    this.managesListener = options.managesListener ?? true;
    this.panningModel = options.panningModel ?? "HRTF";
    this.master = context.createGain();
    this.master.connect(options.destination ?? context.destination);
  }

  now() {
    return this.context.currentTime;
  }

  play(
    speakerId: string,
    samples: Float32Array,
    sampleRate: number,
    when: number,
  ) {
    const nodes = this.nodesOf(speakerId);
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(nodes.gain);
    source.onended = () => source.disconnect();
    source.start(Math.max(when, this.context.currentTime));
  }

  place(speakerId: string, placement: VoicePlacement) {
    const nodes = this.nodesOf(speakerId);
    const at = this.context.currentTime;
    const muffle = Math.min(1, Math.max(0, placement.muffle));
    const gain =
      Math.max(0, placement.gain) * (1 - (1 - MUFFLED_GAIN) * muffle);
    nodes.gain.gain.setTargetAtTime(gain, at, SMOOTHING);
    nodes.filter.frequency.setTargetAtTime(
      OPEN_CUTOFF_HZ * (MUFFLED_CUTOFF_HZ / OPEN_CUTOFF_HZ) ** muffle,
      at,
      SMOOTHING,
    );

    // An undirected voice sits on the ear itself.
    const [x, y, z] = placement.position ?? this.ear;
    const wasSpatial = nodes.isSpatial;
    nodes.isSpatial = placement.position !== null;
    const panner = nodes.panner;
    if (panner.positionX) {
      if (wasSpatial && nodes.isSpatial) {
        panner.positionX.setTargetAtTime(x, at, SMOOTHING);
        panner.positionY.setTargetAtTime(y, at, SMOOTHING);
        panner.positionZ.setTargetAtTime(z, at, SMOOTHING);
      } else {
        // Coming from, or going to, the ear: no glide across the world.
        panner.positionX.setValueAtTime(x, at);
        panner.positionY.setValueAtTime(y, at);
        panner.positionZ.setValueAtTime(z, at);
      }
    } else {
      panner.setPosition(x, y, z);
    }
  }

  setListener({ position, forward, up }: VoiceListener) {
    this.ear = position;
    if (!this.managesListener) return;
    const listener = this.context.listener;
    const at = this.context.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position[0], at, SMOOTHING);
      listener.positionY.setTargetAtTime(position[1], at, SMOOTHING);
      listener.positionZ.setTargetAtTime(position[2], at, SMOOTHING);
      listener.forwardX.setTargetAtTime(forward[0], at, SMOOTHING);
      listener.forwardY.setTargetAtTime(forward[1], at, SMOOTHING);
      listener.forwardZ.setTargetAtTime(forward[2], at, SMOOTHING);
      listener.upX.setTargetAtTime(up[0], at, SMOOTHING);
      listener.upY.setTargetAtTime(up[1], at, SMOOTHING);
      listener.upZ.setTargetAtTime(up[2], at, SMOOTHING);
    } else {
      listener.setPosition(position[0], position[1], position[2]);
      listener.setOrientation(
        forward[0],
        forward[1],
        forward[2],
        up[0],
        up[1],
        up[2],
      );
    }
  }

  setVolume(volume: number) {
    this.master.gain.setTargetAtTime(
      Math.max(0, volume),
      this.context.currentTime,
      SMOOTHING,
    );
  }

  resume() {
    if (this.context.state === "suspended") void this.context.resume();
  }

  remove(speakerId: string) {
    const nodes = this.speakers.get(speakerId);
    if (!nodes) return;
    nodes.gain.disconnect();
    nodes.filter.disconnect();
    nodes.panner.disconnect();
    this.speakers.delete(speakerId);
  }

  dispose() {
    for (const speakerId of Array.from(this.speakers.keys())) {
      this.remove(speakerId);
    }
    this.master.disconnect();
  }

  private nodesOf(speakerId: string): SpeakerNodes {
    let nodes = this.speakers.get(speakerId);
    if (nodes) return nodes;
    const gain = this.context.createGain();
    // Silent until placed: a voice must not play at full volume from
    // nowhere for the frame before its player is found.
    gain.gain.value = 0;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = OPEN_CUTOFF_HZ;
    filter.Q.value = 0.7;
    const panner = this.context.createPanner();
    panner.panningModel = this.panningModel;
    // Direction only: the distance falloff is the gain above, on a curve
    // that reaches silence at the world's voice range.
    panner.distanceModel = "linear";
    panner.rolloffFactor = 0;
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this.master);
    nodes = { gain, filter, panner, isSpatial: false };
    this.speakers.set(speakerId, nodes);
    return nodes;
  }
}
