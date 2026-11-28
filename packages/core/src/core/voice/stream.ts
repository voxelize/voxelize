import { VOICE_FRAME_MS, VoiceDecoder, VoiceDecoderFactory } from "./codec";
import { VoiceJitterBuffer, VoiceJitterBufferOptions } from "./jitter-buffer";
import { levelFromRms, rms } from "./level";
import { VoicePlayout, VoicePlayoutOptions } from "./playout";
import { VoiceSink } from "./sink";

export type VoiceStreamOptions = {
  jitter?: Partial<VoiceJitterBufferOptions>;
  playout?: Partial<VoicePlayoutOptions>;
};

/** After a speaker's last sound they still count as speaking this long, in seconds. */
const SPEAKING_HOLD = 0.2;

/** The level falls this much of the scale a second once the sound stops. */
const LEVEL_RELEASE_PER_SECOND = 3;

/** A decoder that failed is replaced, but not more often than this. */
const DECODER_RETRY_MS = 1000;

/** With no decodable sound, frames that keep arriving still mean speaking. */
const UNDECODED_SPEAKING_MS = 300;

/**
 * One speaker's voice on its way to the ear: frames in whatever order they
 * arrive, out as an unbroken stream on the sink, with the level of what is
 * playing right now for whoever draws it.
 */
export class VoiceStream {
  /** When the last frame arrived, in the caller's milliseconds. */
  lastArrivalMs = Number.NEGATIVE_INFINITY;

  /** Frames the decoder would not take. */
  decodeErrors = 0;

  readonly jitter: VoiceJitterBuffer<Uint8Array>;

  readonly playout: VoicePlayout;

  private decoder: VoiceDecoder | null = null;

  private decoderFailedAtMs = Number.NEGATIVE_INFINITY;

  /** `lostBefore` of each frame handed to the decoder, oldest first. */
  private pendingLost: number[] = [];

  /** Loudness of queued audio by the time it starts, oldest first. */
  private queuedLevels: { at: number; until: number; level: number }[] = [];

  private level = 0;

  private levelAt = 0;

  /** When the last queued frame ends, on the sink's clock. */
  private audibleUntil = Number.NEGATIVE_INFINITY;

  private hasDecoded = false;

  private framesSent = 0;

  constructor(
    readonly speakerId: string,
    private createDecoder: VoiceDecoderFactory,
    private sink: VoiceSink,
    options: VoiceStreamOptions = {},
  ) {
    this.jitter = new VoiceJitterBuffer(options.jitter);
    this.playout = new VoicePlayout(options.playout);
  }

  /** Take a frame that arrived at `nowMs`. */
  push(seq: number, data: Uint8Array, isEnd: boolean, nowMs: number) {
    this.lastArrivalMs = nowMs;
    if (data.byteLength > 0) this.jitter.push(seq, data, nowMs);
    this.tick(nowMs);
    if (isEnd) {
      // Whatever is still held plays; the next utterance starts clean.
      for (const { frame, lostBefore } of this.jitter.flush()) {
        this.decode(frame, lostBefore, nowMs);
      }
    }
  }

  /** Decode every frame whose turn has come. */
  tick(nowMs: number) {
    for (const { frame, lostBefore } of this.jitter.drain(nowMs)) {
      this.decode(frame, lostBefore, nowMs);
    }
  }

  /** Whether this speaker's voice is sounding now (or just was). */
  isSpeaking(nowMs: number): boolean {
    const clock = this.sink.now();
    if (clock <= this.audibleUntil + SPEAKING_HOLD) return true;
    // A stream that will not decode still says someone is talking.
    return (
      !this.hasDecoded && nowMs - this.lastArrivalMs < UNDECODED_SPEAKING_MS
    );
  }

  /** The loudness of what is playing right now, 0..1, eased down after it. */
  currentLevel(): number {
    const clock = this.sink.now();
    const elapsed = Math.max(0, clock - this.levelAt);
    this.levelAt = clock;
    let level = Math.max(0, this.level - LEVEL_RELEASE_PER_SECOND * elapsed);
    let started = 0;
    for (const queued of this.queuedLevels) {
      if (queued.at > clock) break;
      started += 1;
      if (queued.until > clock - 0.1) level = Math.max(level, queued.level);
    }
    if (started > 0) this.queuedLevels.splice(0, started);
    this.level = level;
    return level;
  }

  dispose() {
    this.closeDecoder();
    this.jitter.reset();
    this.queuedLevels = [];
    this.sink.remove(this.speakerId);
  }

  private decode(data: Uint8Array, lostBefore: number, nowMs: number) {
    const decoder = this.decoderFor(nowMs);
    if (!decoder) return;
    this.pendingLost.push(lostBefore);
    try {
      decoder.decode(data, this.framesSent * VOICE_FRAME_MS * 1000);
      this.framesSent += 1;
    } catch (error) {
      this.pendingLost.pop();
      this.onDecoderError(error, nowMs);
    }
  }

  private decoderFor(nowMs: number): VoiceDecoder | null {
    if (this.decoder) return this.decoder;
    if (nowMs - this.decoderFailedAtMs < DECODER_RETRY_MS) return null;
    try {
      this.decoder = this.createDecoder(
        (samples, sampleRate) => this.onSamples(samples, sampleRate),
        (error) => this.onDecoderError(error, this.lastArrivalMs),
      );
    } catch (error) {
      this.onDecoderError(error, nowMs);
    }
    return this.decoder;
  }

  private onSamples(samples: Float32Array, sampleRate: number) {
    const lostBefore = this.pendingLost.shift() ?? 0;
    if (samples.length === 0 || !(sampleRate > 0)) return;
    this.hasDecoded = true;
    const duration = samples.length / sampleRate;
    const startAt = this.playout.schedule(
      this.sink.now(),
      duration,
      lostBefore,
    );
    if (startAt === null) return;
    this.sink.play(this.speakerId, samples, sampleRate, startAt);
    this.audibleUntil = startAt + duration;
    this.queuedLevels.push({
      at: startAt,
      until: startAt + duration,
      level: levelFromRms(rms(samples)),
    });
    if (this.queuedLevels.length > 64) this.queuedLevels.shift();
  }

  private onDecoderError(_error: unknown, nowMs: number) {
    this.decodeErrors += 1;
    this.decoderFailedAtMs = nowMs;
    this.pendingLost = [];
    this.closeDecoder();
  }

  private closeDecoder() {
    const decoder = this.decoder;
    this.decoder = null;
    if (!decoder) return;
    try {
      decoder.close();
    } catch {
      // Already closed by the error that brought us here.
    }
  }
}
