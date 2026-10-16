import type { MessageProtocol } from "@voxelize/protocol";
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

describe("Network.disconnect during a join", () => {
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
