import { protocol } from "@voxelize/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  /** Answers every decode with the next scripted batch of messages. */
  class FakeDecodeWorker extends EventTarget {
    static script: unknown[][] = [];

    static spawned: FakeDecodeWorker[] = [];

    /** While set, answers are held (a decode still running) until released. */
    static isHolding = false;

    static held: Array<() => void> = [];

    static release(): void {
      FakeDecodeWorker.held.splice(0).forEach((answer) => answer());
    }

    constructor() {
      super();
      FakeDecodeWorker.spawned.push(this);
    }

    postMessage(): void {
      const messages = FakeDecodeWorker.script.shift() ?? [];
      const answer = () =>
        this.dispatchEvent(new MessageEvent("message", { data: messages }));
      if (FakeDecodeWorker.isHolding) FakeDecodeWorker.held.push(answer);
      else queueMicrotask(answer);
    }

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

    sent: Uint8Array[] = [];

    onopen: (() => void) | null = null;

    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;

    onclose: ((event: { code: number; reason: string }) => void) | null = null;

    onerror: ((event: Event) => void) | null = null;

    constructor(readonly url: string) {
      FakeSocket.opened.push(this);
    }

    send(data: Uint8Array): void {
      this.sent.push(data);
    }

    close(): void {
      this.readyState = FakeSocket.CLOSED;
    }

    open(): void {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    }

    /** Deliver one packet; the fake worker decides what it decodes to. */
    receive(): void {
      this.onmessage?.({ data: new ArrayBuffer(1) });
    }
  }

  type Entry = { digest: string; blocks: string };
  /** Stands in for Cache Storage / IndexedDB (read through the priority
   * worker), which the test environment lacks. */
  const store = {
    kept: null as Entry | null,
    reads: 0,
    readDelayMs: 0,
    writes: [] as Entry[],
    clears: 0,
  };
  /** Stands in for localStorage, which holds the synchronous digest hint. */
  const local = new Map<string, string>();

  return { FakeDecodeWorker, FakeSocket, store, local };
});

vi.mock("./workers/decode-worker.ts?worker&inline", () => ({
  default: fakes.FakeDecodeWorker,
}));
vi.mock("../../libs/setWorkerInterval", () => ({
  setWorkerInterval: () => () => undefined,
}));
vi.mock("./registry-cache", async (importOriginal) => {
  const original = await importOriginal<typeof import("./registry-cache")>();
  const { store } = fakes;
  return {
    ...original,
    createRegistryBackend: () => ({
      read: async () => store.kept,
      write: async (entry: { digest: string; blocks: string }) => {
        store.writes.push(entry);
        store.kept = entry;
        return true;
      },
      clear: async () => {
        store.clears += 1;
        store.kept = null;
      },
    }),
    readRegistryInWorker: () => {
      store.reads += 1;
      return new Promise((resolve) =>
        setTimeout(() => resolve(store.kept), store.readDelayMs),
      );
    },
  };
});

import { Network } from "./index";

const { FakeDecodeWorker, FakeSocket, store, local } = fakes;
const HINT_KEY = "voxelize:registry-digest";

const BLOCKS_TEXT =
  '{"air":{"id":0,"faces":[]},"stone":{"id":1,"faces":[{"name":"top"}]}}';
const DIGEST = "0123456789abcdef0123456789abcdef-70";

const fullInit = (digest = DIGEST) => ({
  type: "INIT",
  json:
    `{"blocks":${BLOCKS_TEXT},"registryDigest":"${digest}",` +
    `"id":"client","options":{"chunkSize":16},"registryBlocksLength":${BLOCKS_TEXT.length}}`,
});

const cachedInit = (digest = DIGEST) => ({
  type: "INIT",
  json: {
    id: "client",
    options: { chunkSize: 16 },
    registryDigest: digest,
    registryCached: true,
  },
});

/** The JOIN payloads a socket was handed, decoded. */
const joinsOn = (socket: InstanceType<typeof FakeSocket>) =>
  socket.sent
    .map((bytes) => protocol.Message.decode(bytes))
    .filter((message) => message.type === protocol.Message.Type.JOIN)
    .map((message) => JSON.parse(message.json) as Record<string, unknown>);

describe("Network registry offered from elsewhere", () => {
  let errors: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    errors = [];
    FakeSocket.opened = [];
    FakeDecodeWorker.script = [];
    FakeDecodeWorker.spawned = [];
    FakeDecodeWorker.isHolding = false;
    FakeDecodeWorker.held = [];
    store.kept = null;
    store.reads = 0;
    local.clear();
    store.readDelayMs = 0;
    store.writes = [];
    store.clears = 0;
    vi.stubGlobal("window", { navigator: { hardwareConcurrency: 4 } });
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const openNetwork = async () => {
    const network = new Network();
    const seen: Array<Record<string, unknown>> = [];
    network.register({
      onMessage: (message) => {
        if (message.type === "INIT") seen.push(message.json);
      },
    });
    const connecting = network.connect("http://localhost:4000");
    const socket = FakeSocket.opened.at(-1);
    if (!socket) throw new Error("no socket");
    socket.open();
    await connecting;
    return { network, socket, seen };
  };

  const answer = async (
    socket: InstanceType<typeof FakeSocket>,
    init: unknown,
  ) => {
    FakeDecodeWorker.script.push([init]);
    socket.receive();
    await vi.advanceTimersByTimeAsync(0);
  };

  it("names an offered registry on the first JOIN and completes the small INIT with it", async () => {
    const { network, socket, seen } = await openNetwork();
    expect(network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT })).toBe(
      true,
    );

    const joined = network.join("world");
    expect(joinsOn(socket)[0].registryDigest).toBe(DIGEST);
    await answer(socket, cachedInit());
    await joined;

    expect(seen).toHaveLength(1);
    expect(seen[0].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
    // Confirmed by the INIT, the offered registry is kept like a full one's.
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writes).toEqual([{ digest: DIGEST, blocks: BLOCKS_TEXT }]);
    expect(local.get(HINT_KEY)).toBe(DIGEST);
    expect(store.clears).toBe(0);
    expect(errors).toEqual([]);
  });

  it("names the kept offered registry again when it rejoins after a reconnect", async () => {
    const { network, socket, seen } = await openNetwork();
    network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT });
    const joined = network.join("world");
    await answer(socket, cachedInit());
    await joined;
    await vi.advanceTimersByTimeAsync(0);

    // The socket drops; the reconnect's open handler sends the JOIN again.
    socket.readyState = FakeSocket.CLOSED;
    socket.onclose?.({ code: 1006, reason: "" });
    await vi.advanceTimersByTimeAsync(0);
    network.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    const next = FakeSocket.opened.at(-1);
    if (!next || next === socket) throw new Error("no new socket");
    next.open();
    await vi.advanceTimersByTimeAsync(0);

    expect(joinsOn(next)[0].registryDigest).toBe(DIGEST);
    await answer(next, cachedInit());
    expect(seen).toHaveLength(2);
    expect(seen[1].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
    expect(store.writes).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("does not write an offered registry storage already keeps", async () => {
    keepHint();
    const { network, socket, seen } = await openNetwork();
    network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT });
    const joined = network.join("world");
    await answer(socket, cachedInit());
    await joined;
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toHaveLength(1);
    expect(store.writes).toEqual([]);
    expect(store.clears).toBe(0);
  });

  it("completes the INIT with the very objects parsed ahead of it", async () => {
    const { network, socket, seen } = await openNetwork();
    network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT });
    const parsed = network.parseHeldRegistry();
    expect(parsed?.digest).toBe(DIGEST);
    // Parsed once: asking again hands back the same objects.
    expect(network.parseHeldRegistry()).toBe(parsed);

    const joined = network.join("world");
    await answer(socket, cachedInit());
    await joined;

    expect(seen[0].blocks).toBe(parsed?.blocks);
    // The objects belong to that INIT; nothing is held for another.
    expect(network.parseHeldRegistry()).toBeNull();
  });

  it("takes the full INIT and keeps its registry when the offer is stale", async () => {
    const { network, socket, seen } = await openNetwork();
    const stale = "ffffffffffffffffffffffffffffffff-9";
    network.offerRegistry({ digest: stale, blocks: '{"old":{}}' });
    const parsed = network.parseHeldRegistry();

    const joined = network.join("world");
    expect(joinsOn(socket)[0].registryDigest).toBe(stale);
    // The server holds another registry, so it sends its own in full.
    await answer(socket, fullInit());
    await joined;

    expect(seen[0].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
    expect(seen[0].blocks).not.toBe(parsed?.blocks);
    expect(seen[0].registryDigest).toBe(DIGEST);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writes).toEqual([{ digest: DIGEST, blocks: BLOCKS_TEXT }]);
    expect(errors).toEqual([]);
  });

  it("ignores an offer once a JOIN that named nothing is out, and after the INIT", async () => {
    const { network, socket, seen } = await openNetwork();
    const joined = network.join("world");
    expect(joinsOn(socket)[0].registryDigest).toBeUndefined();

    expect(network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT })).toBe(
      false,
    );
    expect(network.parseHeldRegistry()).toBeNull();

    await answer(socket, fullInit());
    await joined;
    expect(seen).toHaveLength(1);
    expect(network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT })).toBe(
      false,
    );
  });

  it("refuses an entry with no digest or no text", async () => {
    const { network } = await openNetwork();
    expect(network.offerRegistry(null)).toBe(false);
    expect(network.offerRegistry({ digest: "", blocks: BLOCKS_TEXT })).toBe(
      false,
    );
    expect(network.offerRegistry({ digest: DIGEST, blocks: "" })).toBe(false);
    expect(network.parseHeldRegistry()).toBeNull();
  });

  it("parses nothing from text that is not a registry", async () => {
    const { network } = await openNetwork();
    expect(network.offerRegistry({ digest: DIGEST, blocks: "{not json" })).toBe(
      true,
    );
    expect(network.parseHeldRegistry()).toBeNull();
  });

  it("serves an INIT waiting on the storage read as soon as the same registry is offered", async () => {
    keepHint();
    store.readDelayMs = 60_000;
    const { network, socket, seen } = await openNetwork();
    const joined = network.join("world");
    expect(joinsOn(socket)[0].registryDigest).toBe(DIGEST);

    await answer(socket, cachedInit());
    expect(seen).toEqual([]);
    expect(network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT })).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(0);
    await joined;
    expect(seen).toHaveLength(1);
    expect(seen[0].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
    expect(FakeSocket.opened).toHaveLength(1);
  });

  it("wakes a waiter when a registry comes into hand, or answers null in time", async () => {
    const { network } = await openNetwork();
    const timedOut = network.whenRegistryHeld(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(timedOut).resolves.toBeNull();

    const waiting = network.whenRegistryHeld(10_000);
    network.offerRegistry({ digest: DIGEST, blocks: BLOCKS_TEXT });
    await expect(waiting).resolves.toEqual({
      digest: DIGEST,
      blocks: BLOCKS_TEXT,
    });
    await expect(network.whenRegistryHeld(0)).resolves.toEqual({
      digest: DIGEST,
      blocks: BLOCKS_TEXT,
    });
  });

  /** An earlier page load's storage hint, its entry still there. */
  const keepHint = () => {
    store.kept = { digest: DIGEST, blocks: BLOCKS_TEXT };
    local.set(HINT_KEY, DIGEST);
  };
});
