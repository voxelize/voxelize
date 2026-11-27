/** Voice is captured, encoded and decoded at this rate. */
export const VOICE_SAMPLE_RATE = 48000;

/** One frame is this long: the usual Opus frame for speech. */
export const VOICE_FRAME_MS = 20;

/** Samples in one frame. */
export const VOICE_FRAME_SAMPLES = (VOICE_SAMPLE_RATE * VOICE_FRAME_MS) / 1000;

/** The encoder's target, in bits per second. Clear speech; about 3 kB/s. */
export const VOICE_BITRATE = 24000;

/** Turns frames of samples into encoded packets, one packet a frame. */
export interface VoiceEncoder {
  /** Encode one frame of {@link VOICE_FRAME_SAMPLES} mono samples. */
  encode(samples: Float32Array, timestampUs: number): void;
  close(): void;
}

/** Turns encoded packets back into samples, in the order they are given. */
export interface VoiceDecoder {
  decode(data: Uint8Array, timestampUs: number): void;
  close(): void;
}

export type VoiceEncoderFactory = (
  onPacket: (data: Uint8Array) => void,
  onError: (error: Error) => void,
) => VoiceEncoder;

export type VoiceDecoderFactory = (
  onSamples: (samples: Float32Array, sampleRate: number) => void,
  onError: (error: Error) => void,
) => VoiceDecoder;

/**
 * Whether this browser can encode and decode voice: WebCodecs audio, which
 * every browser that runs WebGPU has.
 */
export function isVoiceCodecAvailable(): boolean {
  return (
    typeof AudioEncoder === "function" &&
    typeof AudioDecoder === "function" &&
    typeof AudioData === "function" &&
    typeof EncodedAudioChunk === "function"
  );
}

/** The Opus encoder WebCodecs provides, tuned for speech. */
export const createOpusEncoder: VoiceEncoderFactory = (onPacket, onError) => {
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      onPacket(data);
    },
    error: (error) => onError(error),
  });
  const base = {
    codec: "opus",
    sampleRate: VOICE_SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: VOICE_BITRATE,
  };
  // Speech tuning: a browser that does not know a key ignores it, and one
  // that refuses the set gets the plain configuration.
  const tuned = {
    ...base,
    opus: {
      format: "opus",
      frameDuration: VOICE_FRAME_MS * 1000,
      application: "voip",
      signal: "voice",
      // Silence between words costs a byte or two a frame instead of the
      // full bitrate.
      usedtx: true,
      // Each packet carries a little of the one before it, so a single lost
      // packet can be covered.
      useinbandfec: true,
      packetlossperc: 5,
    },
  };
  try {
    encoder.configure(tuned as AudioEncoderConfig);
  } catch {
    encoder.configure(base);
  }
  return {
    encode(samples, timestampUs) {
      if (encoder.state !== "configured") return;
      const frame = new AudioData({
        format: "f32",
        sampleRate: VOICE_SAMPLE_RATE,
        numberOfFrames: samples.length,
        numberOfChannels: 1,
        timestamp: timestampUs,
        data: samples as Float32Array<ArrayBuffer>,
      });
      try {
        encoder.encode(frame);
      } finally {
        frame.close();
      }
    },
    close() {
      if (encoder.state !== "closed") encoder.close();
    },
  };
};

/** The Opus decoder WebCodecs provides. */
export const createOpusDecoder: VoiceDecoderFactory = (onSamples, onError) => {
  const decoder = new AudioDecoder({
    output: (frame) => {
      try {
        const samples = new Float32Array(frame.numberOfFrames);
        frame.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
        onSamples(samples, frame.sampleRate);
      } finally {
        frame.close();
      }
    },
    error: (error) => onError(error),
  });
  decoder.configure({
    codec: "opus",
    sampleRate: VOICE_SAMPLE_RATE,
    numberOfChannels: 1,
  });
  return {
    decode(data, timestampUs) {
      if (decoder.state !== "configured") return;
      decoder.decode(
        new EncodedAudioChunk({
          // Every Opus packet decodes on its own.
          type: "key",
          timestamp: timestampUs,
          duration: VOICE_FRAME_MS * 1000,
          data,
        }),
      );
    },
    close() {
      if (decoder.state !== "closed") decoder.close();
    },
  };
};
