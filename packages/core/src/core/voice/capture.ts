import { VOICE_FRAME_SAMPLES, VOICE_SAMPLE_RATE } from "./codec";

/** A microphone the player can pick. */
export type VoiceInputDevice = {
  deviceId: string;
  label: string;
};

/** Why a microphone could not be opened. */
export type VoiceCaptureProblem =
  /** The player or the browser refused the permission. */
  | "blocked"
  /** No microphone is plugged in, or the chosen one is gone. */
  | "no-device"
  /** Anything else: the device is in use, the page is not secure, ... */
  | "failed";

export class VoiceCaptureError extends Error {
  constructor(
    public problem: VoiceCaptureProblem,
    message: string,
  ) {
    super(message);
    this.name = "VoiceCaptureError";
  }
}

/** A source of microphone frames. */
export interface VoiceCapture {
  /**
   * Open the microphone and start handing 20 ms frames of mono samples at
   * 48 kHz to `onFrame`. Rejects with a {@link VoiceCaptureError}.
   */
  start(
    deviceId: string | null,
    onFrame: (samples: Float32Array) => void,
    onEnded: () => void,
  ): Promise<void>;

  /** Close the microphone. The browser's "in use" mark goes with it. */
  stop(): void;

  /** Start capturing if the browser is holding it until a click or a key. */
  resume?(): void;
}

export type VoiceCaptureFactory = () => VoiceCapture;

const PROCESSOR_NAME = "voxelize-voice-capture";

/**
 * Runs on the audio thread: collects the 128-sample render quanta into
 * whole voice frames and posts each one. Capturing here, not on the main
 * thread, is what keeps a long game frame from dropping words: the samples
 * are already in a message by the time the page is busy.
 */
const PROCESSOR_SOURCE = `
class VoxelizeVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(${VOICE_FRAME_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, ${VOICE_FRAME_SAMPLES} - this.filled);
      this.frame.set(channel.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === ${VOICE_FRAME_SAMPLES}) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(${VOICE_FRAME_SAMPLES});
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", VoxelizeVoiceCapture);
`;

const problemOf = (error: unknown): VoiceCaptureProblem => {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-device";
  }
  return "failed";
};

/** Whether this browser can open a microphone at all. */
export function isMicrophoneAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioContext === "function" &&
    typeof AudioWorkletNode === "function"
  );
}

/**
 * The microphones the browser will name. Labels are empty until the player
 * has granted the microphone once; those come back as "Microphone N".
 */
export async function listVoiceInputDevices(): Promise<VoiceInputDevice[]> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.mediaDevices?.enumerateDevices !== "function"
  ) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput" && device.deviceId)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}

/**
 * The player's microphone, through the browser's own echo cancelling,
 * noise suppression and gain control, as 20 ms frames.
 */
export class MicrophoneCapture implements VoiceCapture {
  private stream: MediaStream | null = null;

  private context: AudioContext | null = null;

  private node: AudioWorkletNode | null = null;

  /** Counts starts, so a stop during a slow start cancels that start. */
  private generation = 0;

  async start(
    deviceId: string | null,
    onFrame: (samples: Float32Array) => void,
    onEnded: () => void,
  ): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    if (!isMicrophoneAvailable()) {
      throw new VoiceCaptureError(
        "failed",
        "This browser cannot open a microphone here (it needs a secure page and AudioWorklet).",
      );
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      throw new VoiceCaptureError(
        problemOf(error),
        error instanceof Error ? error.message : String(error),
      );
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    // Its own context at the codec's rate: the browser resamples the device
    // once, here, and the game's output context can run at whatever rate
    // the speakers want.
    const context = new AudioContext({
      sampleRate: VOICE_SAMPLE_RATE,
      latencyHint: "interactive",
    });
    const moduleUrl = URL.createObjectURL(
      new Blob([PROCESSOR_SOURCE], { type: "application/javascript" }),
    );
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      throw new VoiceCaptureError(
        "failed",
        `The microphone worklet would not load: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (generation === this.generation) onFrame(event.data);
    };
    // A node is only run while it leads somewhere; this leads to silence.
    const silence = context.createGain();
    silence.gain.value = 0;
    source.connect(node);
    node.connect(silence);
    silence.connect(context.destination);

    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (generation === this.generation) onEnded();
      });
    });
    if (context.state === "suspended") void context.resume();

    this.stream = stream;
    this.context = context;
    this.node = node;
  }

  resume() {
    if (this.context?.state === "suspended") void this.context.resume();
  }

  stop() {
    this.generation += 1;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }
}
