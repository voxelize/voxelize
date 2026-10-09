import { MessageProtocol } from "@voxelize/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const INIT = 1;
  const POISON = 255;

  /**
   * Decodes a two-byte packet `[kind, value]` into a message whose `text` is
   * the value. A worker can be dead from the start, like one the renderer
   * killed for memory, or die on the poison packet: a dead worker swallows
   * every job and never raises an event, which is how a killed worker looks.
   */
  class FakeDecodeWorker extends EventTarget {
    static spawned: FakeDecodeWorker[] = [];

    isDead = false;

    isTerminated = false;

    constructor(readonly workerOptions?: WorkerOptions) {
      super();
      FakeDecodeWorker.spawned.push(this);
    }

    postMessage(data: unknown): void {
      const buffers = (Array.isArray(data) ? data : [data]) as ArrayBuffer[];
      if (buffers.some((buffer) => new Uint8Array(buffer)[0] === POISON)) {
        this.isDead = true;
      }
      if (this.isDead || this.isTerminated) return;
      const messages = buffers.map((buffer) => {
        const [kind, value] = new Uint8Array(buffer);
        return kind === INIT
          ? { type: "INIT", json: { id: "client" }, text: String(value) }
          : { type: "EVENT", text: String(value) };
      });
      queueMicrotask(() =>
        this.dispatchEvent(new MessageEvent("message", { data: messages })),
      );
    }

    terminate(): void {
      this.isTerminated = true;
    }
  }

  return { FakeDecodeWorker, INIT, POISON };
});

vi.mock("./workers/decode-worker.ts?worker&inline", () => ({
  default: fakes.FakeDecodeWorker,
}));
vi.mock("../../libs/setWorkerInterval", () => ({
  setWorkerInterval: () => () => undefined,
}));

import { Network } from "./index";

const { FakeDecodeWorker, INIT, POISON } = fakes;
const EVENT = 0;

type NetworkInternals = {
  enqueuePacket: (buffer: ArrayBuffer) => void;
  decodePriority: (buffer: ArrayBuffer) => void;
  waitingForInit: boolean;
};

const internals = (network: Network) => network as unknown as NetworkInternals;

const packet = (kind: number, value: number) =>
  new Uint8Array([kind, value]).buffer;

/** A connected network whose four decode workers and priority worker are fakes. */
const connectedNetwork = (
  options: ConstructorParameters<typeof Network>[0],
) => {
  const network = new Network({
    maxDecodeWorkers: 4,
    maxPacketsPerDecodeJob: 2,
    decodeJobTimeoutMs: 1000,
    ...options,
  });
  network.connected = true;
  const received: string[] = [];
  network.register({
    onMessage: (message: MessageProtocol) => {
      received.push(String(message.text));
    },
  });
  return { network, received };
};

const receive = (network: Network, ...packets: ArrayBuffer[]) => {
  for (const buffer of packets) internals(network).enqueuePacket(buffer);
  network.sync();
};

describe("Network decode recovery", () => {
  let errors: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { navigator: { hardwareConcurrency: 4 } });
    FakeDecodeWorker.spawned = [];
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes a dead worker's packets again on a fresh worker, still in order", async () => {
    const { network, received } = connectedNetwork({});
    const [firstWorker] = FakeDecodeWorker.spawned;
    firstWorker.isDead = true;

    receive(network, packet(EVENT, 1), packet(EVENT, 2));
    receive(network, packet(EVENT, 3), packet(EVENT, 4));
    await vi.advanceTimersByTimeAsync(0);
    // The second job is decoded, but its messages wait for the first's.
    expect(received).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);

    expect(received).toEqual(["1", "2", "3", "4"]);
    expect(firstWorker.isTerminated).toBe(true);
    expect(errors.some((line) => line.includes("Decoding them again"))).toBe(
      true,
    );
  });

  it("gives up loudly on packets that kill every worker, and moves on", async () => {
    const { network, received } = connectedNetwork({ maxDecodeAttempts: 2 });

    receive(network, packet(POISON, 0), packet(EVENT, 7));
    receive(network, packet(EVENT, 8), packet(EVENT, 9));
    await vi.advanceTimersByTimeAsync(2000);

    expect(received).toEqual(["8", "9"]);
    expect(network.droppedPacketCount).toBe(2);
    expect(
      errors.some((line) =>
        line.includes("Gave up decoding 2 packet(s) after 2 failed attempt(s)"),
      ),
    ).toBe(true);
  });

  it("replaces a dead priority worker so a rejoin's INIT still lands", async () => {
    const { network, received } = connectedNetwork({});
    const priorityWorker = FakeDecodeWorker.spawned.at(-1);
    if (!priorityWorker) throw new Error("no priority worker was spawned");
    priorityWorker.isDead = true;
    internals(network).waitingForInit = true;

    internals(network).decodePriority(packet(INIT, 5));
    await vi.advanceTimersByTimeAsync(0);
    expect(network.isJoinPending).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    expect(network.isJoinPending).toBe(false);
    expect(network.joinGeneration).toBe(1);
    expect(received).toEqual(["5"]);
    expect(priorityWorker.isTerminated).toBe(true);
  });
});
