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

type NetworkInternals = { maybeRetryJoin: () => void };

const retryTick = (network: Network) =>
  (network as unknown as NetworkInternals).maybeRetryJoin();

describe("Network join retry", () => {
  let now: number;
  let errors: string[];

  beforeEach(() => {
    now = 0;
    errors = [];
    FakeSocket.opened = [];
    vi.stubGlobal("window", { navigator: { hardwareConcurrency: 4 } });
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
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
    return { network, socket };
  };

  it("waits out a slow answer to a JOIN the open socket carried, instead of making the server replay the INIT", async () => {
    const { network, socket } = await openNetwork();
    void network.join("world");
    expect(socket.sent).toHaveLength(1);

    now = 30_000;
    retryTick(network);

    // A loaded server answered rejoins 14-15 s after the JOIN; a second JOIN
    // at 10 s made it send the whole INIT again, applied ~15 s into the
    // restored session as a second rejoin.
    expect(socket.sent).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("sends the JOIN again, loudly, when the open socket never answers it", async () => {
    const { network, socket } = await openNetwork();
    void network.join("world");

    now = 60_000;
    retryTick(network);

    expect(socket.sent).toHaveLength(2);
    expect(
      errors.some((line) =>
        line.includes("no INIT for 60s on the socket that carried it"),
      ),
    ).toBe(true);
  });

  it("retries a JOIN that never reached an open socket on the short timeout", async () => {
    const network = new Network({ joinRetryTimeout: 10_000 });
    void network.connect("http://localhost:4000");
    await vi.waitFor(() => expect(FakeSocket.opened).toHaveLength(1));
    const [socket] = FakeSocket.opened;

    // Joined while the socket was still connecting: nothing was handed over.
    void network.join("world");
    expect(socket.sent).toHaveLength(0);

    // The socket opens without its open event having run the rejoin yet.
    socket.readyState = FakeSocket.OPEN;
    now = 10_000;
    retryTick(network);

    expect(socket.sent).toHaveLength(1);
  });
});
