import { MessageProtocol, protocol } from "@voxelize/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  /** A decode worker that never answers: these tests decode on arrival. */
  class SilentDecodeWorker extends EventTarget {
    jobs: unknown[] = [];

    constructor(readonly workerOptions?: WorkerOptions) {
      super();
    }

    postMessage(data: unknown): void {
      this.jobs.push(data);
    }

    terminate(): void {}
  }
  return { SilentDecodeWorker };
});

vi.mock("./workers/decode-worker.ts?worker&inline", () => ({
  default: fakes.SilentDecodeWorker,
}));
vi.mock("../../libs/setWorkerInterval", () => ({
  setWorkerInterval: () => () => undefined,
}));

import { Network } from "./index";

type NetworkInternals = {
  deliverOnArrival: (buffer: ArrayBuffer) => boolean;
  enqueuePacket: (buffer: ArrayBuffer) => void;
  packetQueue: ArrayBuffer[];
};

const internals = (network: Network) => network as unknown as NetworkInternals;

/** A real wire packet: an EVENT message carrying `text`. */
const packet = (text: string): ArrayBuffer => {
  const bytes = protocol.Message.encode(
    protocol.Message.create({ type: protocol.Message.Type.EVENT, text }),
  ).finish();
  // A copy: protobufjs can hand back a view into a shared (pooled) buffer.
  return Uint8Array.from(bytes).buffer;
};

const joinedNetwork = (wantsOnArrival: () => boolean) => {
  const network = new Network({ maxDecodeWorkers: 2 });
  network.connected = true;
  const received: MessageProtocol[] = [];
  network.register({
    onMessage: (message: MessageProtocol) => {
      received.push(message);
    },
    wantsMessagesOnArrival: wantsOnArrival,
  });
  return { network, received };
};

describe("Network delivery on arrival", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { navigator: { hardwareConcurrency: 2 } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes and hands on a packet the moment it arrives while an intercept waits on it", () => {
    const { network, received } = joinedNetwork(() => true);
    const before = performance.now();
    expect(internals(network).deliverOnArrival(packet("a"))).toBe(true);
    expect(internals(network).deliverOnArrival(packet("b"))).toBe(true);
    expect(received.map((message) => [message.type, message.text])).toEqual([
      ["EVENT", "a"],
      ["EVENT", "b"],
    ]);
    expect(received[0].perfArrivedAt).toBeGreaterThanOrEqual(before);
    expect(internals(network).packetQueue).toHaveLength(0);
  });

  it("hands on packets still queued for the workers first, in order", () => {
    const { network, received } = joinedNetwork(() => true);
    internals(network).enqueuePacket(packet("queued"));
    expect(internals(network).deliverOnArrival(packet("late"))).toBe(true);
    expect(received.map((message) => message.text)).toEqual(["queued", "late"]);
    expect(internals(network).packetQueue).toHaveLength(0);
  });

  it("drains the queue on a sync tick too", () => {
    const { network, received } = joinedNetwork(() => true);
    internals(network).enqueuePacket(packet("a"));
    internals(network).enqueuePacket(packet("b"));
    network.sync();
    expect(received.map((message) => message.text)).toEqual(["a", "b"]);
  });

  it("waits behind a job already out with a decode worker", () => {
    let isWaiting = false;
    const { network, received } = joinedNetwork(() => isWaiting);
    internals(network).enqueuePacket(packet("with a worker"));
    network.sync();
    isWaiting = true;
    expect(internals(network).deliverOnArrival(packet("late"))).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("leaves packets to the decode workers when nothing waits on them", () => {
    const { network, received } = joinedNetwork(() => false);
    expect(internals(network).deliverOnArrival(packet("a"))).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("hands an undecodable packet to the decode workers", () => {
    const { network, received } = joinedNetwork(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const garbage = new Uint8Array([0x0a, 0xff, 0xff, 0xff]).buffer;
    expect(internals(network).deliverOnArrival(garbage)).toBe(false);
    expect(received).toHaveLength(0);
  });
});
