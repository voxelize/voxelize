import { MessageProtocol, protocol } from "@voxelize/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  class FakeDecodeWorker extends EventTarget {
    postMessage(): void {}

    terminate(): void {}
  }

  /** A socket that records what is handed to it and opens on command. */
  class FakeSocket {
    static CONNECTING = 0;

    static OPEN = 1;

    static CLOSED = 3;

    static opened: FakeSocket[] = [];

    readyState = FakeSocket.CONNECTING;

    binaryType = "blob";

    sent: unknown[] = [];

    onopen: (() => void) | null = null;

    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;

    onclose: ((event: { code: number; reason: string }) => void) | null = null;

    onerror: ((event: Event) => void) | null = null;

    constructor(readonly url: string) {
      FakeSocket.opened.push(this);
    }

    send(data: unknown): void {
      this.sent.push(data);
    }

    close(): void {
      this.readyState = FakeSocket.CLOSED;
    }

    open(): void {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    }
  }

  return { FakeDecodeWorker, FakeSocket };
});

vi.mock("./workers/decode-worker.ts?worker&inline", () => ({
  default: fakes.FakeDecodeWorker,
}));
vi.mock("../../libs/setWorkerInterval", () => ({
  setWorkerInterval: () => () => undefined,
}));

import { Network } from "./index";

const { FakeSocket } = fakes;

type NetworkInternals = { onMessage: (message: MessageProtocol) => void };

/** How a promise ended, or "pending" if it has not by the time this asks. */
const settledAs = (promise: Promise<unknown>) => {
  let state: { kind: string; reason?: unknown } = { kind: "pending" };
  promise.then(
    () => {
      state = { kind: "resolved" };
    },
    (reason: unknown) => {
      state = { kind: "rejected", reason };
    },
  );
  return () => state;
};

/** Lets every queued microtask run, and nothing that waits on a timer. */
const drainMicrotasks = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe("Network connection lifecycle and sending", () => {
  beforeEach(() => {
    FakeSocket.opened = [];
    vi.stubGlobal("window", { navigator: { hardwareConcurrency: 4 } });
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const openNetwork = async () => {
    const network = new Network({ joinRetryTimeout: 10_000 });
    const connecting = network.connect("http://localhost:4000");
    await vi.waitFor(() => expect(FakeSocket.opened).toHaveLength(1));
    const [socket] = FakeSocket.opened;
    socket.open();
    await connecting;
    return network;
  };

  it("sends a reused update with the same type and the caller's latest values", async () => {
    const network = await openNetwork();
    try {
      const message = {
        type: "UPDATE",
        updates: [{ vx: -2, vy: 3, vz: 4, voxel: 7 }],
      };
      expect(network.send(message)).toBe(true);
      message.updates[0].voxel = 9;
      expect(network.send(message)).toBe(true);
      const frames = FakeSocket.opened[0].sent.map((bytes) =>
        protocol.Message.decode(bytes as Uint8Array),
      );
      expect(frames.map((frame) => frame.type)).toEqual([
        protocol.Message.Type.UPDATE,
        protocol.Message.Type.UPDATE,
      ]);
      expect(frames.map((frame) => frame.updates[0].voxel)).toEqual([7, 9]);
      expect(message.type).toBe("UPDATE");
    } finally {
      network.disconnect();
    }
  });

  it("accepts a frozen command without changing its JSON", async () => {
    const network = await openNetwork();
    const json = Object.freeze({
      center: [0, 0],
      direction: [0, 1],
      chunks: [[0, 0]],
    });
    const message = Object.freeze({ type: "LOAD", json });
    try {
      expect(network.send(message)).toBe(true);
      expect(network.send(message)).toBe(true);
      for (const bytes of FakeSocket.opened[0].sent) {
        const frame = protocol.Message.decode(bytes as Uint8Array);
        expect(frame.type).toBe(protocol.Message.Type.LOAD);
        expect(JSON.parse(frame.json)).toEqual(json);
      }
      expect(message.json).toBe(json);
    } finally {
      network.disconnect();
    }
  });

  it("passes the original packet to an intercept's sent callback", async () => {
    const network = await openNetwork();
    const message: MessageProtocol = {
      type: "LOAD",
      json: { center: [0, 0], direction: [0, 1], chunks: [[0, 0]] },
    };
    const before = structuredClone(message);
    const sent: MessageProtocol[] = [];
    network.register({
      packets: [message],
      onPacketsSent: (packets) => sent.push(...packets),
    });
    try {
      network.flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toBe(message);
      expect(sent[0]).toEqual(before);
    } finally {
      network.disconnect();
    }
  });

  it("serializes frozen entity and peer records without replacing their metadata", async () => {
    const network = await openNetwork();
    const metadata = Object.freeze({ position: [1, 2, 3] });
    const entity = Object.freeze({ id: "e1", metadata });
    const peer = Object.freeze({ id: "p1", metadata });
    const message = Object.freeze({
      type: "ENTITY",
      entities: Object.freeze([entity]),
      peers: Object.freeze([peer]),
    });
    try {
      expect(network.send(message)).toBe(true);
      expect(network.send(message)).toBe(true);
      for (const bytes of FakeSocket.opened[0].sent) {
        const frame = protocol.Message.decode(bytes as Uint8Array);
        expect(frame.type).toBe(protocol.Message.Type.ENTITY);
        expect(JSON.parse(frame.entities[0].metadata)).toEqual(metadata);
        expect(JSON.parse(frame.peers[0].metadata)).toEqual(metadata);
      }
      expect(message.entities[0]).toBe(entity);
      expect(message.peers[0]).toBe(peer);
      expect(entity.metadata).toBe(metadata);
      expect(peer.metadata).toBe(metadata);
    } finally {
      network.disconnect();
    }
  });

  it("leaves a command intact when its metadata cannot be serialized", async () => {
    const network = await openNetwork();
    const metadata: { self?: unknown } = {};
    metadata.self = metadata;
    const message = { type: "ENTITY", entities: [{ id: "e1", metadata }] };
    try {
      expect(() => network.send(message)).toThrow(TypeError);
      expect(FakeSocket.opened[0].sent).toHaveLength(0);
      expect(message.type).toBe("ENTITY");
      expect(message.entities[0].metadata).toBe(metadata);
    } finally {
      network.disconnect();
    }
  });

  it("rejects the join still waiting for its INIT within a microtask", async () => {
    const network = await openNetwork();
    const joined = network.join("world");
    const state = settledAs(joined);

    network.disconnect();
    expect(state().kind).toBe("pending");

    // No timer, no socket event: only microtasks (the queued reject, then
    // `join`'s own async wrapper adopting it) stand between the two.
    await drainMicrotasks();
    expect(state()).toEqual({
      kind: "rejected",
      reason: "network closed before INIT",
    });
  });

  it("keeps the server's own reason when an ERROR ends the join", async () => {
    const network = await openNetwork();
    const joined = network.join("world");
    const state = settledAs(joined);

    (network as unknown as NetworkInternals).onMessage({
      type: "ERROR",
      text: "world is full",
    } as MessageProtocol);

    await drainMicrotasks();
    expect(state()).toEqual({ kind: "rejected", reason: "world is full" });
  });

  it("rejects nothing when no join is waiting", async () => {
    const network = await openNetwork();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      network.disconnect();
      network.disconnect();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
